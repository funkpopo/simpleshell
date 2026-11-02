//! term-pipe: terminal output processing in the core, equivalent to the
//! main process's output path (`terminalOutput.js`): streaming UTF-8 decode,
//! OSC-safe syntax highlighting, editor-mode detection and stderr styling.

mod editor;
mod highlight;
mod osc;
pub mod pattern;
mod rules;
pub mod service;
mod utf8;

pub use editor::EditorMode;
pub use highlight::Highlighter;
pub use osc::OscFilter;
pub use rules::{validate_rules, RuleCheck, RuleConfig};
pub use utf8::Utf8Decoder;

use std::collections::HashMap;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::sync::{Arc, Mutex, OnceLock};

/// JavaScript's whitespace set (`\s`, `String.prototype.trim`).
pub(crate) fn js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{0b}' | '\u{0c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}

/// Compiled highlighters by rule-set key, so terminals share a compilation.
pub fn highlighter_for(rules: &[RuleConfig], key: &str) -> Arc<Highlighter> {
    static CACHE: OnceLock<Mutex<HashMap<u64, Arc<Highlighter>>>> = OnceLock::new();
    let mut hasher = DefaultHasher::new();
    key.hash(&mut hasher);
    let hash = hasher.finish();
    let mut cache = CACHE
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    if cache.len() > 16 {
        cache.clear();
    }
    Arc::clone(
        cache
            .entry(hash)
            .or_insert_with(|| Arc::new(Highlighter::new(rules))),
    )
}

/// Processed output of one chunk.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Processed {
    pub text: String,
    /// New editor-mode state when it changed.
    pub editor_mode: Option<bool>,
}

/// Per-terminal output pipeline.
pub struct TermPipe {
    stdout: Utf8Decoder,
    stderr: Utf8Decoder,
    osc: OscFilter,
    editor: EditorMode,
    highlighter: Option<Arc<Highlighter>>,
}

impl TermPipe {
    /// Without a highlighter text is only decoded and passed through.
    pub fn new(highlighter: Option<Arc<Highlighter>>) -> Self {
        Self {
            stdout: Utf8Decoder::default(),
            stderr: Utf8Decoder::default(),
            osc: OscFilter::default(),
            editor: EditorMode::default(),
            highlighter,
        }
    }

    fn process(&mut self, text: &str, is_final: bool) -> Processed {
        let mut editor_mode = None;
        let editor = &mut self.editor;
        let highlighter = self.highlighter.as_deref();
        let text = self.osc.transform(text, is_final, |visible| {
            if let Some(changed) = editor.observe(visible) {
                editor_mode = Some(changed);
            }
            match highlighter {
                Some(highlighter) => highlighter.apply(visible),
                None => visible.to_string(),
            }
        });
        Processed { text, editor_mode }
    }

    pub fn stdout(&mut self, bytes: &[u8]) -> Processed {
        let text = self.stdout.decode(bytes);
        if text.is_empty() {
            return Processed::default();
        }
        self.process(&text, false)
    }

    /// Stderr is shown in red and never highlighted.
    pub fn stderr(&mut self, bytes: &[u8]) -> String {
        let text = self.stderr.decode(bytes);
        if text.is_empty() {
            text
        } else {
            format!("\x1b[31m{text}\x1b[0m")
        }
    }

    /// Flushes decoder remainders at the end of the stream.
    pub fn finish(&mut self) -> Processed {
        let text = self.stdout.finish();
        let mut processed = self.process(&text, true);
        let stderr = self.stderr.finish();
        if !stderr.is_empty() {
            processed.text.push_str(&format!("\x1b[31m{stderr}\x1b[0m"));
        }
        processed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pipeline_decodes_highlights_and_tracks_editor_mode() {
        let rules: Vec<RuleConfig> = serde_json::from_str(
            r#"[{"type":"regex","enabled":true,"pattern":"\\berror\\b","flags":"g","style":"color: red;"}]"#,
        )
        .unwrap();
        let mut pipe = TermPipe::new(Some(Arc::new(Highlighter::new(&rules))));
        let bytes = "中 error\x1b]0;error\x07 less".as_bytes();
        let first = pipe.stdout(&bytes[..2]);
        assert_eq!(first.text, "");
        let rest = pipe.stdout(&bytes[2..]);
        assert_eq!(rest.text, "中 \x1b[31merror\x1b[0m\x1b]0;error\x07 less");
        assert_eq!(rest.editor_mode, Some(true));
        assert_eq!(pipe.stderr(b"oops"), "\x1b[31moops\x1b[0m");
        assert_eq!(pipe.finish(), Processed::default());
    }
}
