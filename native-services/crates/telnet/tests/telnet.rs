//! `telnet` against a small in-test server that negotiates, asks for a
//! login and echoes lines.

use core_protocol::testing::{contains, TestStream};
use serde_json::json;
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

const IAC: u8 = 255;
const DO: u8 = 253;
const WILL: u8 = 251;
const SB: u8 = 250;
const SE: u8 = 240;

/// Starts the server; returns its port and everything the client sent.
async fn server() -> (u16, Arc<Mutex<Vec<u8>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let received = Arc::new(Mutex::new(Vec::new()));
    let log = Arc::clone(&received);
    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        socket
            .write_all(&[
                IAC, DO, 31, IAC, DO, 24, IAC, WILL, 1, IAC, SB, 24, 1, IAC, SE,
            ])
            .await
            .unwrap();
        socket.write_all(b"Welcome\r\nbox login: ").await.unwrap();
        let mut stage = 0;
        let mut buffer = [0u8; 4096];
        loop {
            let count = match socket.read(&mut buffer).await {
                Ok(0) | Err(_) => return,
                Ok(count) => count,
            };
            let text = {
                let mut log = log.lock().unwrap();
                log.extend_from_slice(&buffer[..count]);
                String::from_utf8_lossy(&log).to_string()
            };
            if stage == 0 && text.contains("tester\r\n") {
                stage = 1;
                socket.write_all(b"\r\nPassword: ").await.unwrap();
            } else if stage == 1 && text.contains("secret\r\n") {
                stage = 2;
                socket.write_all(b"\r\n$ ").await.unwrap();
            } else if stage == 2 && text.ends_with('\r') {
                let line = text.rsplit("\r\n").next().unwrap_or("").trim_end();
                let echoed = format!("\r\n{}\r\n$ ", line.rsplit('\r').nth(1).unwrap_or(line));
                socket.write_all(echoed.as_bytes()).await.unwrap();
            }
        }
    });
    (port, received)
}

fn sent(received: &Arc<Mutex<Vec<u8>>>) -> Vec<u8> {
    received.lock().unwrap().clone()
}

fn includes(haystack: &[u8], needle: &[u8]) -> bool {
    haystack
        .windows(needle.len())
        .any(|window| window == needle)
}

#[tokio::test]
async fn negotiates_logs_in_and_reports_window_size() {
    let (port, received) = server().await;
    let mut telnet = TestStream::open(telnet::serve);
    telnet.send(json!({
        "type": "open", "host": "127.0.0.1", "port": port,
        "username": "tester", "password": "secret", "cols": 100, "rows": 30,
        "term": "xterm-256color",
    }));
    telnet.event_of("connected").await;
    telnet.stdout_until("$ ").await;
    assert!(contains(&telnet.stdout, "Welcome\r\nbox login: "));
    assert!(
        !telnet.stdout.contains(&IAC),
        "protocol bytes are not output"
    );

    let client = sent(&received);
    assert!(includes(
        &client,
        &[IAC, WILL, 31, IAC, SB, 31, 0, 100, 0, 30, IAC, SE]
    ));
    assert!(includes(&client, &[IAC, WILL, 24]));
    assert!(includes(&client, b"\xff\xfa\x18\x00xterm-256color\xff\xf0"));
    assert!(includes(&client, &[IAC, DO, 1]));

    telnet.send(json!({"type": "resize", "cols": 255, "rows": 50}));
    // Typed bytes go out as is, with IAC doubled.
    telnet.write(b"hi \xff\r");
    telnet.stdout_until("hi").await;
    let client = sent(&received);
    assert!(includes(
        &client,
        &[IAC, SB, 31, 0, IAC, IAC, 0, 50, IAC, SE]
    ));
    assert!(includes(&client, b"hi \xff\xff\r"));

    telnet.send(json!({"type": "close"}));
    telnet.event_of("closed").await;
}

#[tokio::test]
async fn reports_a_refused_connection() {
    let port = {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        listener.local_addr().unwrap().port()
    };
    let mut refused = TestStream::open(telnet::serve);
    refused.send(json!({"type": "open", "host": "127.0.0.1", "port": port}));
    let error = refused.event().await;
    assert_eq!(error["code"], "ECONNREFUSED", "{error}");
    assert!(error["message"].as_str().unwrap().contains("ECONNREFUSED"));
}
