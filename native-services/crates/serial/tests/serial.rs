//! `serial-port` / `serial-list` without hardware: listing and open failures.

use core_protocol::testing::TestStream;
use serde_json::json;

#[tokio::test]
async fn reports_a_missing_port() {
    let path = if cfg!(windows) {
        "COM239"
    } else {
        "/dev/simpleshell-no-such-tty"
    };
    let mut port = TestStream::open(serial::serve);
    port.send(json!({"type": "open", "path": path, "baudRate": 9600}));
    let error = port.event().await;
    assert_eq!(error["type"], "error");
    assert_eq!(error["code"], "ENOENT", "{error}");
}

#[tokio::test]
async fn rejects_invalid_settings_before_opening() {
    let mut port = TestStream::open(serial::serve);
    port.send(json!({"type": "open", "path": "COM1", "baudRate": 9600, "parity": "mark"}));
    let error = port.event().await;
    assert_eq!(error["code"], "EINVAL", "{error}");
}

#[tokio::test]
async fn lists_ports_as_json() {
    let mut list = TestStream::open(|_io| serial::run_list());
    list.drain_for(std::time::Duration::from_millis(500)).await;
    let ports: Vec<serde_json::Value> = serde_json::from_slice(&list.stdout).unwrap();
    for port in ports {
        assert!(port["path"].as_str().is_some_and(|path| !path.is_empty()));
    }
}
