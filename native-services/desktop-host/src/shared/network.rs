//! 共享代理类型与 TCP/代理隧道建连实现。
//!
//! 从 `sidecars/file_management/mod.rs` 原样提取，供文件管理与延迟模块共同调用，
//! 保证两侧建连行为一致。语义与 JS `proxy-manager.js` 保持一致：`http`/`https`
//! 标签都表示“用于 HTTP(S) 请求的代理”，代理本身通常是明文 HTTP CONNECT；
//! `socks4`/`socks5` 走相应握手。不支持的类型明确报错，不偷偷直连。

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::net::IpAddr;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::timeout;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyConfig {
    pub r#type: String,
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SafeProxyConfig {
    pub r#type: String,
    pub host: String,
    pub port: u16,
    pub source: Option<String>,
    pub has_auth: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkPath {
    pub mode: String,
    pub proxy_required: bool,
    pub proxy: Option<SafeProxyConfig>,
}

pub fn safe_proxy_config(proxy: &ProxyConfig) -> SafeProxyConfig {
    SafeProxyConfig {
        r#type: proxy.r#type.trim().to_ascii_lowercase(),
        host: proxy.host.clone(),
        port: proxy.port,
        source: proxy.source.clone(),
        has_auth: proxy
            .username
            .as_deref()
            .is_some_and(|value| !value.is_empty())
            || proxy
                .password
                .as_deref()
                .is_some_and(|value| !value.is_empty()),
    }
}

pub fn direct_network_path(proxy_required: bool) -> NetworkPath {
    NetworkPath {
        mode: "direct".to_string(),
        proxy_required,
        proxy: None,
    }
}

pub const PROXY_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(15);
pub const HTTP_PROXY_HEADER_LIMIT: usize = 64 * 1024;

pub async fn connect_tcp(host: &str, port: u16, label: &str) -> Result<TcpStream, String> {
    let stream = timeout(PROXY_HANDSHAKE_TIMEOUT, TcpStream::connect((host, port)))
        .await
        .map_err(|_| format!("{label} TCP connect timed out"))?
        .map_err(|error| format!("{label} TCP connect failed: {error}"))?;
    let _ = stream.set_nodelay(true);
    Ok(stream)
}

pub async fn connect_via_proxy(
    proxy: &ProxyConfig,
    target_host: &str,
    target_port: u16,
) -> Result<TcpStream, String> {
    match proxy.r#type.trim().to_ascii_lowercase().as_str() {
        "http" | "https" => connect_via_http_proxy(proxy, target_host, target_port).await,
        "socks5" => connect_via_socks5_proxy(proxy, target_host, target_port).await,
        "socks4" => connect_via_socks4_proxy(proxy, target_host, target_port).await,
        other => Err(format!("unsupported proxy type: {other}")),
    }
}

pub async fn write_all_proxy(
    socket: &mut TcpStream,
    bytes: &[u8],
    label: &str,
) -> Result<(), String> {
    timeout(PROXY_HANDSHAKE_TIMEOUT, socket.write_all(bytes))
        .await
        .map_err(|_| format!("proxy handshake timed out while writing {label}"))?
        .map_err(|error| format!("proxy handshake failed while writing {label}: {error}"))
}

pub async fn read_exact_proxy(
    socket: &mut TcpStream,
    bytes: &mut [u8],
    label: &str,
) -> Result<(), String> {
    timeout(PROXY_HANDSHAKE_TIMEOUT, socket.read_exact(bytes))
        .await
        .map_err(|_| format!("proxy handshake timed out while reading {label}"))?
        .map_err(|error| format!("proxy handshake failed while reading {label}: {error}"))?;
    Ok(())
}

pub fn host_port_for_connect(host: &str, port: u16) -> String {
    if host.parse::<IpAddr>().is_ok() && host.contains(':') {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    }
}

pub async fn read_http_proxy_header(socket: &mut TcpStream) -> Result<Vec<u8>, String> {
    let mut header = Vec::with_capacity(256);
    let mut byte = [0u8; 1];

    loop {
        read_exact_proxy(socket, &mut byte, "HTTP proxy CONNECT response").await?;
        header.push(byte[0]);

        if header.ends_with(b"\r\n\r\n") {
            return Ok(header);
        }

        if header.len() > HTTP_PROXY_HEADER_LIMIT {
            return Err("proxy HTTP CONNECT response header is too large".to_string());
        }
    }
}

pub async fn connect_via_http_proxy(
    proxy: &ProxyConfig,
    target_host: &str,
    target_port: u16,
) -> Result<TcpStream, String> {
    let mut socket = connect_tcp(&proxy.host, proxy.port, "HTTP proxy").await?;
    let target = host_port_for_connect(target_host, target_port);
    let mut headers = vec![
        format!("CONNECT {target} HTTP/1.1"),
        format!("Host: {target}"),
        "Proxy-Connection: Keep-Alive".to_string(),
        "Connection: Keep-Alive".to_string(),
    ];

    if let Some(username) = proxy.username.as_deref().filter(|value| !value.is_empty()) {
        let token = BASE64_STANDARD.encode(format!(
            "{}:{}",
            username,
            proxy.password.as_deref().unwrap_or("")
        ));
        headers.push(format!("Proxy-Authorization: Basic {token}"));
    }

    let request = format!("{}\r\n\r\n", headers.join("\r\n"));
    write_all_proxy(
        &mut socket,
        request.as_bytes(),
        "HTTP proxy CONNECT request",
    )
    .await?;

    let header = read_http_proxy_header(&mut socket).await?;
    let header_text = String::from_utf8_lossy(&header);
    let status_line = header_text.lines().next().unwrap_or("").trim();
    let status_code = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(0);

    if status_code != 200 {
        if status_code == 407 {
            return Err(format!(
                "proxy HTTP CONNECT authentication required: {status_line}"
            ));
        }
        return Err(format!("proxy HTTP CONNECT failed: {status_line}"));
    }

    Ok(socket)
}

pub async fn connect_via_socks5_proxy(
    proxy: &ProxyConfig,
    target_host: &str,
    target_port: u16,
) -> Result<TcpStream, String> {
    let mut socket = connect_tcp(&proxy.host, proxy.port, "SOCKS5 proxy").await?;
    let has_auth = proxy
        .username
        .as_deref()
        .is_some_and(|value| !value.is_empty());
    let greeting: Vec<u8> = if has_auth {
        vec![0x05, 0x02, 0x02, 0x00]
    } else {
        vec![0x05, 0x01, 0x00]
    };
    write_all_proxy(&mut socket, &greeting, "SOCKS5 greeting").await?;

    let mut method_response = [0u8; 2];
    read_exact_proxy(&mut socket, &mut method_response, "SOCKS5 method response").await?;
    if method_response[0] != 0x05 {
        return Err("proxy SOCKS5 returned an invalid method response".to_string());
    }
    match method_response[1] {
        0x00 => {}
        0x02 => {
            let username = proxy.username.as_deref().unwrap_or("");
            let password = proxy.password.as_deref().unwrap_or("");
            let username_bytes = username.as_bytes();
            let password_bytes = password.as_bytes();
            if username_bytes.len() > u8::MAX as usize || password_bytes.len() > u8::MAX as usize {
                return Err("proxy SOCKS5 username/password is too long".to_string());
            }

            let mut auth = Vec::with_capacity(3 + username_bytes.len() + password_bytes.len());
            auth.push(0x01);
            auth.push(username_bytes.len() as u8);
            auth.extend_from_slice(username_bytes);
            auth.push(password_bytes.len() as u8);
            auth.extend_from_slice(password_bytes);
            write_all_proxy(&mut socket, &auth, "SOCKS5 authentication").await?;

            let mut auth_response = [0u8; 2];
            read_exact_proxy(
                &mut socket,
                &mut auth_response,
                "SOCKS5 authentication response",
            )
            .await?;
            if auth_response != [0x01, 0x00] {
                return Err("proxy SOCKS5 authentication failed".to_string());
            }
        }
        0xff => return Err("proxy SOCKS5 has no acceptable authentication method".to_string()),
        method => {
            return Err(format!(
                "proxy SOCKS5 selected unsupported authentication method 0x{method:02x}"
            ))
        }
    }

    let mut request = vec![0x05, 0x01, 0x00];
    match target_host.parse::<IpAddr>() {
        Ok(IpAddr::V4(ip)) => {
            request.push(0x01);
            request.extend_from_slice(&ip.octets());
        }
        Ok(IpAddr::V6(ip)) => {
            request.push(0x04);
            request.extend_from_slice(&ip.octets());
        }
        Err(_) => {
            let host_bytes = target_host.as_bytes();
            if host_bytes.len() > u8::MAX as usize {
                return Err("proxy SOCKS5 target host is too long".to_string());
            }
            request.push(0x03);
            request.push(host_bytes.len() as u8);
            request.extend_from_slice(host_bytes);
        }
    }
    request.extend_from_slice(&target_port.to_be_bytes());
    write_all_proxy(&mut socket, &request, "SOCKS5 CONNECT request").await?;

    let mut response_head = [0u8; 4];
    read_exact_proxy(&mut socket, &mut response_head, "SOCKS5 CONNECT response").await?;
    if response_head[0] != 0x05 {
        return Err("proxy SOCKS5 returned an invalid CONNECT response".to_string());
    }
    if response_head[1] != 0x00 {
        return Err(format!(
            "proxy SOCKS5 CONNECT failed with reply 0x{:02x}",
            response_head[1]
        ));
    }

    match response_head[3] {
        0x01 => {
            let mut rest = [0u8; 6];
            read_exact_proxy(&mut socket, &mut rest, "SOCKS5 IPv4 bind address").await?;
        }
        0x04 => {
            let mut rest = [0u8; 18];
            read_exact_proxy(&mut socket, &mut rest, "SOCKS5 IPv6 bind address").await?;
        }
        0x03 => {
            let mut len = [0u8; 1];
            read_exact_proxy(&mut socket, &mut len, "SOCKS5 domain bind length").await?;
            let mut rest = vec![0u8; len[0] as usize + 2];
            read_exact_proxy(&mut socket, &mut rest, "SOCKS5 domain bind address").await?;
        }
        atyp => return Err(format!("proxy SOCKS5 returned invalid ATYP 0x{atyp:02x}")),
    }

    Ok(socket)
}

pub async fn connect_via_socks4_proxy(
    proxy: &ProxyConfig,
    target_host: &str,
    target_port: u16,
) -> Result<TcpStream, String> {
    let mut socket = connect_tcp(&proxy.host, proxy.port, "SOCKS4 proxy").await?;
    let user_id = proxy.username.as_deref().unwrap_or("").as_bytes();
    if user_id.contains(&0) {
        return Err("proxy SOCKS4 username contains a NUL byte".to_string());
    }

    let mut request = vec![0x04, 0x01];
    request.extend_from_slice(&target_port.to_be_bytes());
    match target_host.parse::<IpAddr>() {
        Ok(IpAddr::V4(ip)) => {
            request.extend_from_slice(&ip.octets());
            request.extend_from_slice(user_id);
            request.push(0x00);
        }
        _ => {
            let host_bytes = target_host.as_bytes();
            if host_bytes.contains(&0) {
                return Err("proxy SOCKS4 target host contains a NUL byte".to_string());
            }
            request.extend_from_slice(&[0x00, 0x00, 0x00, 0x01]);
            request.extend_from_slice(user_id);
            request.push(0x00);
            request.extend_from_slice(host_bytes);
            request.push(0x00);
        }
    }

    write_all_proxy(&mut socket, &request, "SOCKS4 CONNECT request").await?;
    let mut response = [0u8; 8];
    read_exact_proxy(&mut socket, &mut response, "SOCKS4 CONNECT response").await?;
    if response[0] != 0x00 && response[0] != 0x04 {
        return Err("proxy SOCKS4 returned an invalid response".to_string());
    }
    if response[1] != 0x5a {
        return Err(format!(
            "proxy SOCKS4 CONNECT failed with code 0x{:02x}",
            response[1]
        ));
    }

    Ok(socket)
}
