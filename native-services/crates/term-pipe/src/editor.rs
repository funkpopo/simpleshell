//! Editor-mode detection (`OutputProcessor.processTerminalOutput`): output
//! naming an editor or pager turns it on; an exit command line turns it off.

use crate::pattern::JsRegex;
use std::sync::OnceLock;

fn command() -> &'static JsRegex {
    static PATTERN: OnceLock<JsRegex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        JsRegex::new(r"\b(vi|vim|nano|emacs|pico|ed|less|more|cat|man)\b", "").unwrap()
    })
}

fn exit() -> &'static JsRegex {
    static PATTERN: OnceLock<JsRegex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        JsRegex::new(r"^(q|quit|exit|wq|ZZ|x|:q|:wq|:x|Ctrl\+X|:\w+)$", "i").unwrap()
    })
}

#[derive(Default)]
pub struct EditorMode {
    active: bool,
}

impl EditorMode {
    pub fn active(&self) -> bool {
        self.active
    }

    /// Updates the state from decoded output; returns the new state on change.
    pub fn observe(&mut self, output: &str) -> Option<bool> {
        let before = self.active;
        if command().is_match(output) {
            self.active = true;
        }
        if self.active && exit().is_match(output.trim_matches(crate::js_whitespace)) {
            self.active = false;
        }
        (self.active != before).then_some(self.active)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tracks_editor_commands_and_exits() {
        let mut mode = EditorMode::default();
        assert_eq!(mode.observe("$ vim file.txt\r\n"), Some(true));
        assert_eq!(mode.observe("some text"), None);
        assert_eq!(mode.observe("  :wq\r\n"), Some(false));
        assert_eq!(mode.observe("vimrc"), None);
    }
}
