//! `diagnostic-echo`: a tiny stream used to verify the core's isolation rules.
//!
//! Each input line is echoed, except for commands:
//! `panic` panics the stream task, `fail` returns an error, and `ticker`
//! starts a background task that emits `tick` every 20 ms until the stream ends.

use core_protocol::service::{self, Input};
use std::time::Duration;
use tokio::io::AsyncBufReadExt;

pub async fn echo(input: Input) -> Result<(), String> {
    let mut lines = input.lines();
    while let Some(line) = lines
        .next_line()
        .await
        .map_err(|error| format!("failed to read input: {error}"))?
    {
        match line.as_str() {
            "panic" => panic!("diagnostic panic requested"),
            "fail" => return Err("diagnostic failure requested".to_string()),
            "ticker" => {
                service::spawn(async {
                    loop {
                        tokio::time::sleep(Duration::from_millis(20)).await;
                        if service::emit_line("tick").is_err() {
                            break;
                        }
                    }
                });
                service::emit_line("ticker started")?;
            }
            _ => service::emit_line(line)?,
        }
    }
    Ok(())
}
