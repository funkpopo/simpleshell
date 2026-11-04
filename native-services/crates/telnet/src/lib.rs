//! `telnet`: a Telnet terminal session.
//!
//! The first event connects:
//! `open {host, port?, timeoutMs?, username?, password?, cols?, rows?, term?}`
//! and answers `connected` or `error {message, code}` (`code`: ECONNREFUSED,
//! ENOTFOUND, ETIMEDOUT, …, also in the message). Output is the server's
//! terminal data with the protocol removed; input bytes are sent as typed.
//! With `username`, a login prompt (`login:` / `username:` / `用户名:`) at the
//! end of early output is answered with it, and a password prompt
//! (`password:` / `密码:`) with `password`. Events: `resize {cols, rows}`
//! (sent with NAWS once the server asks for it), `pause`, `resume`, `close`.
//! The stream ends with `end` when the server closes, then `closed`.

pub mod protocol;

use bytes::Bytes;
use core_protocol::service::{self, Input};
use core_protocol::StreamIo;
use protocol::{escape, Telnet};
use serde::Deserialize;
use serde_json::{json, Value};
use std::io::ErrorKind;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::mpsc;

const READ_CHUNK: usize = 16 * 1024;
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(15);
/// Automatic login only looks at the start of a session.
const LOGIN_WINDOW_BYTES: usize = 64 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Open {
    host: String,
    port: Option<u16>,
    timeout_ms: Option<u64>,
    username: Option<String>,
    password: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
    term: Option<String>,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum Command {
    Open(Box<Open>),
    Resize { cols: u16, rows: u16 },
    Pause,
    Resume,
    Close,
}

fn parse(event: Value) -> Option<Command> {
    serde_json::from_value(event).ok()
}

/// A connect failure as `(message, node-style code)`.
fn connect_error(error: &std::io::Error, target: &str) -> (String, &'static str) {
    let code = match error.kind() {
        ErrorKind::ConnectionRefused => "ECONNREFUSED",
        ErrorKind::TimedOut => "ETIMEDOUT",
        ErrorKind::ConnectionReset => "ECONNRESET",
        ErrorKind::PermissionDenied => "EACCES",
        _ if error.to_string().contains("lookup")
            || error.to_string().contains("No such host")
            || error.to_string().contains("not known") =>
        {
            "ENOTFOUND"
        }
        _ => "ECONNECT",
    };
    (format!("connect {code} {target}: {error}"), code)
}

async fn connect(open: &Open) -> Result<TcpStream, (String, &'static str)> {
    let target = format!("{}:{}", open.host, open.port.unwrap_or(23));
    let limit = open
        .timeout_ms
        .filter(|ms| *ms > 0)
        .map_or(DEFAULT_TIMEOUT, Duration::from_millis);
    let attempt = async {
        let addresses: Vec<_> = tokio::net::lookup_host(&target)
            .await
            .map_err(|error| {
                (
                    format!("getaddrinfo ENOTFOUND {}: {error}", open.host),
                    "ENOTFOUND",
                )
            })?
            .collect();
        let mut last = None;
        for address in addresses {
            match TcpStream::connect(address).await {
                Ok(stream) => return Ok(stream),
                Err(error) => last = Some(connect_error(&error, &target)),
            }
        }
        Err(last.unwrap_or_else(|| (format!("getaddrinfo ENOTFOUND {}", open.host), "ENOTFOUND")))
    };
    match tokio::time::timeout(limit, attempt).await {
        Ok(result) => result,
        Err(_) => Err((format!("connect ETIMEDOUT {target}"), "ETIMEDOUT")),
    }
}

/// Answers login and password prompts once each, early in the session.
/// Public (hidden) only so `fuzz-harness` can drive it with untrusted output.
#[doc(hidden)]
pub struct AutoLogin {
    username: Option<String>,
    password: Option<String>,
    tail: String,
    seen: usize,
}

impl AutoLogin {
    pub fn new(username: Option<String>, password: Option<String>) -> Self {
        Self {
            username: username.filter(|name| !name.is_empty()),
            password,
            tail: String::new(),
            seen: 0,
        }
    }

    fn active(&self) -> bool {
        (self.username.is_some() || self.password.is_some()) && self.seen < LOGIN_WINDOW_BYTES
    }

    /// Bytes to send in reply to newly received output.
    pub fn observe(&mut self, data: &[u8]) -> Option<String> {
        if !self.active() {
            return None;
        }
        self.seen += data.len();
        self.tail.push_str(&String::from_utf8_lossy(data));
        if let Some(line) = self.tail.rfind(['\n', '\r']) {
            self.tail.drain(..=line);
        }
        let prompt = self.tail.trim_end().to_lowercase();
        let is = |suffixes: &[&str]| suffixes.iter().any(|suffix| prompt.ends_with(suffix));
        let answer = if is(&["login:", "username:", "用户名:", "用户名："]) {
            self.username.take()
        } else if self.username.is_none() && is(&["password:", "密码:", "密码："]) {
            self.password.take()
        } else {
            None
        };
        if answer.is_some() {
            self.tail.clear();
        }
        answer.map(|answer| format!("{answer}\r\n"))
    }
}

pub async fn serve(io: StreamIo) -> Result<(), String> {
    let StreamIo { input, mut events } = io;
    let output = service::output();
    let open = loop {
        match events.recv().await.map(parse) {
            Some(Some(Command::Open(open))) => break *open,
            Some(_) => continue,
            None => return Ok(()),
        }
    };
    let stream = match connect(&open).await {
        Ok(stream) => stream,
        Err((message, code)) => {
            output.write_event(&json!({"type": "error", "message": message, "code": code}))?;
            return Ok(());
        }
    };
    let _ = stream.set_nodelay(true);
    output.write_event(&json!({"type": "connected"}))?;

    let mut telnet = Telnet::new(
        open.term.unwrap_or_else(|| "xterm-256color".into()),
        open.cols.unwrap_or(80),
        open.rows.unwrap_or(24),
    );
    let mut login = AutoLogin::new(open.username, open.password);
    let (mut reader, mut writer) = stream.into_split();
    // Everything sent to the server goes through one ordered queue.
    let (send, mut outgoing) = mpsc::unbounded_channel::<Vec<u8>>();
    let writer_task = service::spawn(async move {
        while let Some(bytes) = outgoing.recv().await {
            if writer.write_all(&bytes).await.is_err() {
                break;
            }
        }
        let _ = writer.shutdown().await;
    });
    let stdin = service::spawn(forward_input(input, send.clone()));

    let mut paused = false;
    let mut buffer = vec![0u8; READ_CHUNK];
    loop {
        tokio::select! {
            read = reader.read(&mut buffer), if !paused => match read {
                Ok(0) | Err(_) => {
                    output.write_event(&json!({"type": "end"}))?;
                    break;
                }
                Ok(count) => {
                    let received = telnet.receive(&buffer[..count]);
                    if !received.reply.is_empty() {
                        let _ = send.send(received.reply);
                    }
                    if !received.data.is_empty() {
                        if let Some(answer) = login.observe(&received.data) {
                            let _ = send.send(escape(answer.as_bytes()));
                        }
                        output.write_bytes(Bytes::from(received.data))?;
                    }
                }
            },
            event = events.recv() => match event.map(parse) {
                None | Some(Some(Command::Close)) => break,
                Some(Some(Command::Resize { cols, rows })) => {
                    let report = telnet.resize(cols, rows);
                    if !report.is_empty() {
                        let _ = send.send(report);
                    }
                }
                Some(Some(Command::Pause)) => paused = true,
                Some(Some(Command::Resume)) => paused = false,
                Some(_) => {}
            },
        }
    }
    stdin.abort();
    drop(send);
    let _ = tokio::time::timeout(Duration::from_secs(1), writer_task).await;
    output.write_event(&json!({"type": "closed"}))?;
    Ok(())
}

async fn forward_input(mut input: Input, send: mpsc::UnboundedSender<Vec<u8>>) {
    let mut buffer = vec![0u8; READ_CHUNK];
    while let Ok(count) = input.read(&mut buffer).await {
        if count == 0 || send.send(escape(&buffer[..count])).is_err() {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_connect_errors_to_node_codes() {
        let code = |kind| connect_error(&std::io::Error::from(kind), "h:23").1;
        assert_eq!(code(ErrorKind::ConnectionRefused), "ECONNREFUSED");
        assert_eq!(code(ErrorKind::TimedOut), "ETIMEDOUT");
        let (message, code) = connect_error(
            &std::io::Error::other("failed to lookup address information: No such host is known."),
            "h:23",
        );
        assert_eq!(code, "ENOTFOUND");
        assert!(message.starts_with("connect ENOTFOUND h:23"));
    }

    #[test]
    fn answers_login_then_password_prompts_once() {
        let mut login = AutoLogin::new(Some("root".into()), Some("pw".into()));
        assert_eq!(login.observe(b"Welcome\r\nbox log"), None);
        assert_eq!(login.observe(b"in: "), Some("root\r\n".into()));
        assert_eq!(login.observe(b"\r\nPassword: "), Some("pw\r\n".into()));
        assert_eq!(login.observe(b"\r\nPassword: "), None);
        assert!(!login.active() || login.password.is_none());
    }

    #[test]
    fn ignores_prompt_words_inside_lines_and_without_credentials() {
        let mut login = AutoLogin::new(Some("root".into()), None);
        assert_eq!(login.observe(b"last login: Mon\r\n$ "), None);
        let mut anonymous = AutoLogin::new(None, None);
        assert_eq!(anonymous.observe(b"login: "), None);
        let mut chinese = AutoLogin::new(Some("admin".into()), Some("x".into()));
        assert_eq!(
            chinese.observe("用户名:".as_bytes()),
            Some("admin\r\n".into())
        );
        assert_eq!(
            chinese.observe("\r\n密码:".as_bytes()),
            Some("x\r\n".into())
        );
    }
}
