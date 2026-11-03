//! Serial ports for serial terminal tabs.
//!
//! * `serial-list`: prints a JSON array of ports
//!   (`path`, `friendlyName`, `manufacturer`, `serialNumber`, `vendorId`,
//!   `productId`).
//! * `serial-port`: the first event opens the port:
//!   `open {path, baudRate, dataBits?, stopBits?, parity?, flowControl?}`
//!   (`parity`: none / even / odd; `flowControl`: none / rtscts / xonxoff).
//!   Answers `opened` or `error {message, code}`. Input bytes are written to
//!   the port and output is what it receives. `pause` / `resume` stop and
//!   restart reading; `close` (or the end of input events) closes the port.
//!   A failure while open sends `error` and ends the stream; every end sends
//!   `closed`.

use bytes::Bytes;
use core_protocol::service::{self, Input};
use core_protocol::StreamIo;
use serde::Deserialize;
use serde_json::{json, Value};
use serialport::{DataBits, FlowControl, Parity, SerialPort, SerialPortType, StopBits};
use std::io::{ErrorKind, Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::sync::mpsc;

const READ_CHUNK: usize = 16 * 1024;
const READ_QUEUE: usize = 8;
/// Reads wake up this often to notice a close.
const READ_TIMEOUT: Duration = Duration::from_millis(100);

#[derive(Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
struct Open {
    path: String,
    baud_rate: u32,
    data_bits: Option<u8>,
    stop_bits: Option<u8>,
    parity: Option<String>,
    flow_control: Option<String>,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum Command {
    Open(Box<Open>),
    Pause,
    Resume,
    Close,
}

/// A port failure with the node-style code the main process classifies.
#[derive(Debug, PartialEq)]
struct Failure {
    message: String,
    code: &'static str,
}

impl Failure {
    fn invalid(message: String) -> Self {
        Self {
            message,
            code: "EINVAL",
        }
    }
}

impl From<serialport::Error> for Failure {
    fn from(error: serialport::Error) -> Self {
        let code = match error.kind() {
            serialport::ErrorKind::NoDevice => "ENOENT",
            serialport::ErrorKind::InvalidInput => "EINVAL",
            serialport::ErrorKind::Io(ErrorKind::NotFound) => "ENOENT",
            serialport::ErrorKind::Io(ErrorKind::PermissionDenied) => "EACCES",
            serialport::ErrorKind::Io(_) | serialport::ErrorKind::Unknown => "EIO",
        };
        Self {
            message: error.to_string(),
            code,
        }
    }
}

fn settings(open: &Open) -> Result<(DataBits, StopBits, Parity, FlowControl), Failure> {
    let data_bits = match open.data_bits.unwrap_or(8) {
        5 => DataBits::Five,
        6 => DataBits::Six,
        7 => DataBits::Seven,
        8 => DataBits::Eight,
        other => return Err(Failure::invalid(format!("invalid data bits: {other}"))),
    };
    let stop_bits = match open.stop_bits.unwrap_or(1) {
        1 => StopBits::One,
        2 => StopBits::Two,
        other => return Err(Failure::invalid(format!("invalid stop bits: {other}"))),
    };
    let parity = match open.parity.as_deref().unwrap_or("none") {
        "none" => Parity::None,
        "even" => Parity::Even,
        "odd" => Parity::Odd,
        other => return Err(Failure::invalid(format!("invalid parity: {other}"))),
    };
    let flow_control = match open.flow_control.as_deref().unwrap_or("none") {
        "none" => FlowControl::None,
        "rtscts" => FlowControl::Hardware,
        "xonxoff" => FlowControl::Software,
        other => return Err(Failure::invalid(format!("invalid flow control: {other}"))),
    };
    if open.baud_rate == 0 {
        return Err(Failure::invalid("invalid baud rate: 0".into()));
    }
    Ok((data_bits, stop_bits, parity, flow_control))
}

fn open_port(open: &Open) -> Result<Box<dyn SerialPort>, Failure> {
    let (data_bits, stop_bits, parity, flow_control) = settings(open)?;
    Ok(serialport::new(&open.path, open.baud_rate)
        .data_bits(data_bits)
        .stop_bits(stop_bits)
        .parity(parity)
        .flow_control(flow_control)
        .timeout(READ_TIMEOUT)
        .open()?)
}

pub async fn run_list() -> Result<(), String> {
    let ports = tokio::task::spawn_blocking(serialport::available_ports)
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| format!("failed to list serial ports: {error}"))?;
    let ports: Vec<Value> = ports
        .into_iter()
        .map(|port| {
            let usb = match &port.port_type {
                SerialPortType::UsbPort(usb) => Some(usb),
                _ => None,
            };
            let hex = |value: Option<u16>| value.map(|id| format!("{id:04x}")).unwrap_or_default();
            json!({
                "path": port.port_name,
                "friendlyName": usb
                    .and_then(|usb| usb.product.clone())
                    .unwrap_or_else(|| port.port_name.clone()),
                "manufacturer": usb.and_then(|usb| usb.manufacturer.clone()).unwrap_or_default(),
                "serialNumber": usb.and_then(|usb| usb.serial_number.clone()).unwrap_or_default(),
                "vendorId": hex(usb.map(|usb| usb.vid)),
                "productId": hex(usb.map(|usb| usb.pid)),
            })
        })
        .collect();
    service::emit_json(&ports)
}

fn parse(event: Value) -> Option<Command> {
    serde_json::from_value(event).ok()
}

enum PortRead {
    Chunk(Vec<u8>),
    Failed(Failure),
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
    let port = match tokio::task::spawn_blocking(move || open_port(&open))
        .await
        .map_err(|error| error.to_string())?
    {
        Ok(port) => port,
        Err(failure) => {
            output.write_event(
                &json!({"type": "error", "message": failure.message, "code": failure.code}),
            )?;
            return Ok(());
        }
    };
    let mut writer = port
        .try_clone()
        .map_err(|error| format!("serial port writer: {error}"))?;
    output.write_event(&json!({"type": "opened"}))?;

    let stop = Arc::new(AtomicBool::new(false));
    let (chunks_tx, mut chunks) = mpsc::channel::<PortRead>(READ_QUEUE);
    {
        let stop = Arc::clone(&stop);
        let mut port = port;
        std::thread::spawn(move || {
            let mut buffer = vec![0u8; READ_CHUNK];
            while !stop.load(Ordering::Relaxed) {
                let item = match port.read(&mut buffer) {
                    Ok(0) => continue,
                    Ok(count) => PortRead::Chunk(buffer[..count].to_vec()),
                    Err(error) if error.kind() == ErrorKind::TimedOut => continue,
                    Err(error) if error.kind() == ErrorKind::Interrupted => continue,
                    Err(error) => PortRead::Failed(Failure {
                        message: format!("serial port read failed: {error}"),
                        code: "EIO",
                    }),
                };
                let failed = matches!(item, PortRead::Failed(_));
                if chunks_tx.blocking_send(item).is_err() || failed {
                    break;
                }
            }
        });
    }
    let (input_tx, input_rx) = std::sync::mpsc::channel::<Vec<u8>>();
    std::thread::spawn(move || {
        while let Ok(bytes) = input_rx.recv() {
            if writer
                .write_all(&bytes)
                .and_then(|_| writer.flush())
                .is_err()
            {
                break;
            }
        }
    });
    let stdin = service::spawn(forward_input(input, input_tx));

    let mut paused = false;
    loop {
        tokio::select! {
            item = chunks.recv(), if !paused => match item {
                Some(PortRead::Chunk(chunk)) => output.write_bytes(Bytes::from(chunk))?,
                Some(PortRead::Failed(failure)) => {
                    output.write_event(&json!({
                        "type": "error", "message": failure.message, "code": failure.code,
                    }))?;
                    break;
                }
                None => break,
            },
            event = events.recv() => match event.map(parse) {
                None | Some(Some(Command::Close)) => break,
                Some(Some(Command::Pause)) => paused = true,
                Some(Some(Command::Resume)) => paused = false,
                Some(_) => {}
            },
        }
    }
    stop.store(true, Ordering::Relaxed);
    stdin.abort();
    output.write_event(&json!({"type": "closed"}))?;
    Ok(())
}

async fn forward_input(mut input: Input, sink: std::sync::mpsc::Sender<Vec<u8>>) {
    let mut buffer = vec![0u8; READ_CHUNK];
    while let Ok(count) = input.read(&mut buffer).await {
        if count == 0 || sink.send(buffer[..count].to_vec()).is_err() {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open(extra: Value) -> Open {
        let mut value = json!({"path": "COM9", "baudRate": 115200});
        value
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn maps_settings() {
        assert_eq!(
            settings(&open(json!({}))).unwrap(),
            (
                DataBits::Eight,
                StopBits::One,
                Parity::None,
                FlowControl::None
            )
        );
        assert_eq!(
            settings(&open(json!({
                "dataBits": 7, "stopBits": 2, "parity": "even", "flowControl": "rtscts"
            })))
            .unwrap(),
            (
                DataBits::Seven,
                StopBits::Two,
                Parity::Even,
                FlowControl::Hardware
            )
        );
        assert_eq!(
            settings(&open(json!({"flowControl": "xonxoff", "parity": "odd"})))
                .unwrap()
                .3,
            FlowControl::Software
        );
    }

    #[test]
    fn rejects_unsupported_settings() {
        for extra in [
            json!({"parity": "mark"}),
            json!({"dataBits": 9}),
            json!({"stopBits": 3}),
            json!({"flowControl": "dtr"}),
            json!({"baudRate": 0}),
        ] {
            let failure = settings(&open(extra.clone())).unwrap_err();
            assert_eq!(failure.code, "EINVAL", "{extra}");
            assert!(failure.message.starts_with("invalid "), "{extra}");
        }
    }
}
