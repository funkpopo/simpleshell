//! Services exposing the highlighter to the main process.
//!
//! * `highlight-validate`: stdin is a JSON rule array; stdout one JSON array
//!   of [`RuleCheck`]s. Used to reject rules when settings are saved.
//! * `highlight-text`: NDJSON. The first line is `{"rules": [...]}`; each
//!   later `{"text", "mode"?}` line is answered with `{"output"}`, where mode
//!   `highlight` (default) runs the highlighter alone and `pipe` runs the
//!   whole output pipeline. Used to compare the core with the main process.

use crate::{validate_rules, Highlighter, RuleConfig, TermPipe};
use core_protocol::service::{self, Input};
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncReadExt};

pub async fn run_validate(mut input: Input) -> Result<(), String> {
    let mut payload = String::new();
    input
        .read_to_string(&mut payload)
        .await
        .map_err(|error| format!("failed to read rules: {error}"))?;
    let rules: Vec<RuleConfig> =
        serde_json::from_str(&payload).map_err(|error| format!("invalid rules: {error}"))?;
    service::emit_json(&validate_rules(&rules))
}

#[derive(Deserialize)]
struct Setup {
    rules: Vec<RuleConfig>,
}

#[derive(Deserialize)]
struct Request {
    text: String,
    mode: Option<String>,
}

pub async fn serve_highlight(input: Input) -> Result<(), String> {
    let mut lines = input.lines();
    let read = |line: std::io::Result<Option<String>>| {
        line.map_err(|error| format!("failed to read input: {error}"))
    };
    let Some(first) = read(lines.next_line().await)? else {
        return Ok(());
    };
    let setup: Setup =
        serde_json::from_str(&first).map_err(|error| format!("invalid setup: {error}"))?;
    let highlighter = Arc::new(Highlighter::new(&setup.rules));
    while let Some(line) = read(lines.next_line().await)? {
        let request: Request =
            serde_json::from_str(&line).map_err(|error| format!("invalid request: {error}"))?;
        let output = match request.mode.as_deref() {
            Some("pipe") => {
                let mut pipe = TermPipe::new(Some(Arc::clone(&highlighter)));
                let mut text = pipe.stdout(request.text.as_bytes()).text;
                text.push_str(&pipe.finish().text);
                text
            }
            _ => highlighter.apply(&request.text),
        };
        service::emit_json(&json!({ "output": output }))?;
    }
    Ok(())
}
