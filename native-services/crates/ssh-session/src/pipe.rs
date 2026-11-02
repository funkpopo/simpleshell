//! Terminal pipe mode of `ssh-channel`: channel output is processed here
//! instead of in the main process.
//!
//! Raw output first passes the ZMODEM detector (transfers run in the core and
//! only their events leave it), then the terminal pipeline (UTF-8 decoding,
//! OSC filtering, highlighting, editor-mode detection). Output that follows
//! a quiet period is sent at once; bursts are batched for up to
//! [`BATCH_DELAY`] or [`BATCH_BYTES`] before highlighting, as the main
//! process did, so highlights rarely split across chunks.

use serde::Deserialize;
use serde_json::{json, Value};
use std::time::Duration;
use term_pipe::{highlighter_for, RuleConfig, TermPipe};
use tokio::time::Instant;
use zmodem::{Detector, GrantedFile, Out};

pub const BATCH_DELAY: Duration = Duration::from_millis(8);
pub const BATCH_BYTES: usize = 16 * 1024;
/// ZMODEM timers (held intro prefix, inactivity).
pub const TICK_INTERVAL: Duration = Duration::from_millis(100);

/// `open.pipe`: `{rules?}`; without rules output is not highlighted.
#[derive(Deserialize, Default)]
pub struct PipeOptions {
    rules: Option<Value>,
}

/// What processing produced, in order.
#[derive(Debug, PartialEq)]
pub enum Effect {
    /// Terminal text for the renderer.
    Text(String),
    /// Bytes to write to the channel (ZMODEM protocol).
    Remote(Vec<u8>),
    Event(Value),
}

/// Answers to a transfer's events, from the main process.
#[derive(Deserialize)]
#[serde(tag = "type", rename_all_fields = "camelCase")]
pub enum ZmodemCommand {
    #[serde(rename = "zmodemAccept")]
    Accept { path: String },
    #[serde(rename = "zmodemSend")]
    Send { files: Vec<GrantedFile> },
    #[serde(rename = "zmodemCancel")]
    Cancel,
}

pub struct Pipe {
    zmodem: Detector,
    term: TermPipe,
    pending: Vec<u8>,
    pending_since: Option<Instant>,
    last_flush: Option<Instant>,
}

impl Pipe {
    pub fn new(options: PipeOptions) -> Result<Self, String> {
        let highlighter = match options.rules {
            Some(rules) => {
                let key = rules.to_string();
                let rules: Vec<RuleConfig> = serde_json::from_value(rules)
                    .map_err(|error| format!("invalid highlight rules: {error}"))?;
                Some(highlighter_for(&rules, &key))
            }
            None => None,
        };
        Ok(Self {
            zmodem: Detector::new(),
            term: TermPipe::new(highlighter),
            pending: Vec::new(),
            pending_since: None,
            last_flush: None,
        })
    }

    /// Whether more channel output may be read with `credit` bytes left:
    /// output waiting in the batch already counts against it.
    pub fn accepts_input(&self, credit: i64) -> bool {
        credit > self.pending.len() as i64
            && self.zmodem.unprocessed_bytes() < Detector::BUDGET_BYTES
    }

    /// When the current batch must be flushed.
    pub fn flush_deadline(&self) -> Option<Instant> {
        self.pending_since.map(|since| since + BATCH_DELAY)
    }

    pub async fn stdout(&mut self, bytes: &[u8]) -> Vec<Effect> {
        let outs = self.zmodem.feed(bytes).await;
        self.apply(outs)
    }

    /// Stderr is shown after the stdout received before it.
    pub fn stderr(&mut self, bytes: &[u8]) -> Vec<Effect> {
        let mut effects = self.flush();
        let text = self.term.stderr(bytes);
        if !text.is_empty() {
            effects.push(Effect::Text(text));
        }
        effects
    }

    pub async fn command(&mut self, command: ZmodemCommand) -> Vec<Effect> {
        let outs = match command {
            ZmodemCommand::Accept { path } => self.zmodem.accept_file(&path).await,
            ZmodemCommand::Send { files } => self.zmodem.send_files(files).await,
            ZmodemCommand::Cancel => self.zmodem.cancel().await,
        };
        self.apply(outs)
    }

    pub async fn tick(&mut self) -> Vec<Effect> {
        let outs = self.zmodem.tick().await;
        self.apply(outs)
    }

    /// Processes the pending batch.
    pub fn flush(&mut self) -> Vec<Effect> {
        self.pending_since = None;
        self.last_flush = Some(Instant::now());
        if self.pending.is_empty() {
            return Vec::new();
        }
        let pending = std::mem::take(&mut self.pending);
        let processed = self.term.stdout(&pending);
        Self::processed(processed.text, processed.editor_mode)
    }

    /// End of output: aborts a transfer and flushes every remainder.
    pub fn finish(&mut self) -> Vec<Effect> {
        let outs = self.zmodem.finish();
        let mut effects = self.apply(outs);
        effects.extend(self.flush());
        let processed = self.term.finish();
        effects.extend(Self::processed(processed.text, processed.editor_mode));
        effects
    }

    fn processed(text: String, editor_mode: Option<bool>) -> Vec<Effect> {
        let mut effects = Vec::new();
        if let Some(active) = editor_mode {
            effects.push(Effect::Event(
                json!({"type": "editorMode", "active": active}),
            ));
        }
        if !text.is_empty() {
            effects.push(Effect::Text(text));
        }
        effects
    }

    fn apply(&mut self, outs: Vec<Out>) -> Vec<Effect> {
        let mut effects = Vec::new();
        for out in outs {
            match out {
                Out::Passthrough(bytes) => {
                    // Leading edge: output after a quiet period (an echo, a
                    // prompt) goes out at once; only bursts are batched.
                    let idle = self.pending.is_empty()
                        && self
                            .last_flush
                            .is_none_or(|last| last.elapsed() >= BATCH_DELAY);
                    self.pending.extend_from_slice(&bytes);
                    if idle || self.pending.len() >= BATCH_BYTES {
                        effects.extend(self.flush());
                    } else if self.pending_since.is_none() {
                        self.pending_since = Some(Instant::now());
                    }
                }
                Out::WriteRemote(bytes) => effects.push(Effect::Remote(bytes)),
                Out::Event(kind, event) => {
                    // Text before an intro belongs before the transfer notice.
                    if kind == "intro" {
                        effects.extend(self.flush());
                    }
                    effects.push(Effect::Event(
                        json!({"type": "zmodem", "kind": kind, "event": event}),
                    ));
                }
                Out::Error { message, code } => effects.push(Effect::Event(json!({
                    "type": "zmodem",
                    "kind": "error",
                    "event": {"message": message, "code": code},
                }))),
            }
        }
        effects
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(effects: &[Effect]) -> String {
        effects
            .iter()
            .filter_map(|effect| match effect {
                Effect::Text(text) => Some(text.as_str()),
                _ => None,
            })
            .collect()
    }

    #[tokio::test]
    async fn sends_after_quiet_periods_and_batches_bursts() {
        let mut pipe = Pipe::new(PipeOptions::default()).unwrap();
        let effects = pipe.stdout(b"vim a.txt\r\n").await;
        assert_eq!(
            effects[0],
            Effect::Event(json!({"type": "editorMode", "active": true}))
        );
        assert_eq!(text(&effects), "vim a.txt\r\n");
        // Right behind it: batched until the deadline.
        assert!(pipe.stdout(b"more").await.is_empty());
        assert!(pipe.flush_deadline().is_some());
        assert_eq!(text(&pipe.flush()), "more");
        assert!(pipe.flush_deadline().is_none());
    }

    #[tokio::test]
    async fn stderr_follows_earlier_stdout() {
        let mut pipe = Pipe::new(PipeOptions::default()).unwrap();
        let mut effects = pipe.stdout(b"first ").await;
        effects.extend(pipe.stdout("a\u{e4}".as_bytes()).await);
        effects.extend(pipe.stderr(b"oops"));
        assert_eq!(text(&effects), "first a\u{e4}\x1b[31moops\x1b[0m");
    }

    #[tokio::test]
    async fn highlights_with_rules() {
        let rules = json!([{
            "type": "regex", "enabled": true, "pattern": "error", "flags": "g",
            "style": "color: red;"
        }]);
        let mut pipe = Pipe::new(PipeOptions { rules: Some(rules) }).unwrap();
        let out = text(&pipe.stdout(b"an error").await);
        assert!(out.contains("\x1b[") && out.contains("error"), "{out:?}");
    }

    #[tokio::test]
    async fn zmodem_offer_is_an_event_not_text() {
        let mut pipe = Pipe::new(PipeOptions::default()).unwrap();
        // sz's ZRQINIT header.
        let effects = pipe.stdout(b"before**\x18B00000000000000\r\x8a\x11").await;
        let mut effects = effects;
        effects.extend(pipe.flush());
        assert!(effects.iter().any(|effect| matches!(
            effect,
            Effect::Event(event) if event["type"] == "zmodem" && event["kind"] == "intro"
        )));
        assert!(effects
            .iter()
            .any(|effect| matches!(effect, Effect::Remote(_))));
        assert_eq!(text(&effects), "before");
        let cancelled = pipe.command(ZmodemCommand::Cancel).await;
        assert!(cancelled
            .iter()
            .any(|effect| matches!(effect, Effect::Remote(bytes) if bytes.starts_with(&[24, 24]))));
    }
}
