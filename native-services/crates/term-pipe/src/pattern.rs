//! JavaScript regular expressions on Rust engines.
//!
//! Highlight rules are written for JavaScript `RegExp` (`highlight-configs.js`
//! and user rules). Patterns are translated so the Rust engines see the same
//! language: `\b`, `\w` and `\d` are ASCII-only as in JavaScript (Rust's are
//! Unicode), `[^]` matches anything, and `.` / `^` / `$` treat `\r` as a line
//! terminator. Patterns run on `regex`; those it cannot express (lookaround,
//! backreferences) fall back to `fancy-regex`.

const WORD: &str = "0-9A-Za-z_";

#[derive(Clone, Copy, PartialEq, Eq)]
enum Target {
    Regex,
    Fancy,
}

fn word_boundary(target: Target, negated: bool) -> &'static str {
    match (target, negated) {
        (Target::Regex, false) => r"(?-u:\b)",
        (Target::Regex, true) => r"(?-u:\B)",
        (Target::Fancy, false) => {
            r"(?:(?<=[0-9A-Za-z_])(?![0-9A-Za-z_])|(?<![0-9A-Za-z_])(?=[0-9A-Za-z_]))"
        }
        (Target::Fancy, true) => {
            r"(?:(?<=[0-9A-Za-z_])(?=[0-9A-Za-z_])|(?<![0-9A-Za-z_])(?![0-9A-Za-z_]))"
        }
    }
}

fn hex_escape(chars: &[char], index: &mut usize, out: &mut String) -> bool {
    // `\uXXXX` or `\u{X...}` (index points at the `u`).
    if chars.get(*index + 1) == Some(&'{') {
        if let Some(close) = chars[*index + 2..].iter().position(|c| *c == '}') {
            let digits: String = chars[*index + 2..*index + 2 + close].iter().collect();
            if !digits.is_empty() && digits.chars().all(|c| c.is_ascii_hexdigit()) {
                out.push_str(&format!("\\x{{{digits}}}"));
                *index += 2 + close;
                return true;
            }
        }
        return false;
    }
    let digits: String = chars.iter().skip(*index + 1).take(4).collect();
    if digits.len() == 4 && digits.chars().all(|c| c.is_ascii_hexdigit()) {
        out.push_str(&format!("\\x{{{digits}}}"));
        *index += 4;
        return true;
    }
    false
}

fn translate(pattern: &str, target: Target) -> String {
    let chars: Vec<char> = pattern.chars().collect();
    let mut out = String::with_capacity(pattern.len() + 16);
    let mut in_class = false;
    let mut class_start = 0;
    let mut index = 0;
    while index < chars.len() {
        let c = chars[index];
        if c == '\\' && index + 1 < chars.len() {
            index += 1;
            let escaped = chars[index];
            match (in_class, escaped) {
                (false, 'b') => out.push_str(word_boundary(target, false)),
                (false, 'B') => out.push_str(word_boundary(target, true)),
                (false, 'w') => out.push_str("[0-9A-Za-z_]"),
                (false, 'W') => out.push_str("[^0-9A-Za-z_]"),
                (false, 'd') => out.push_str("[0-9]"),
                (false, 'D') => out.push_str("[^0-9]"),
                (true, 'w') => out.push_str(WORD),
                (true, 'd') => out.push_str("0-9"),
                (true, 'b') => out.push_str(r"\x08"),
                (_, 'u') => {
                    if !hex_escape(&chars, &mut index, &mut out) {
                        out.push('u');
                    }
                }
                (_, '/') => out.push('/'),
                (_, other) => {
                    out.push('\\');
                    out.push(other);
                }
            }
            index += 1;
            continue;
        }
        if in_class {
            match c {
                ']' if index > class_start => {
                    in_class = false;
                    out.push(']');
                }
                // Literal in JavaScript classes, set operators/nesting in Rust.
                '[' | '&' | '~' => {
                    out.push('\\');
                    out.push(c);
                }
                _ => out.push(c),
            }
            index += 1;
            continue;
        }
        if c == '[' {
            if chars.get(index + 1) == Some(&'^') && chars.get(index + 2) == Some(&']') {
                out.push_str("(?s:.)");
                index += 3;
                continue;
            }
            if chars.get(index + 1) == Some(&']') {
                out.push_str(r"[^\x{0}-\x{10FFFF}]");
                index += 2;
                continue;
            }
            in_class = true;
            out.push('[');
            index += 1;
            if chars.get(index) == Some(&'^') {
                out.push('^');
                index += 1;
            }
            class_start = index;
            continue;
        }
        out.push(c);
        index += 1;
    }
    out
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Flags {
    pub global: bool,
    pub ignore_case: bool,
    pub multi_line: bool,
    pub dot_all: bool,
}

impl Flags {
    pub fn parse(flags: &str) -> Self {
        Self {
            global: flags.contains('g'),
            ignore_case: flags.contains('i'),
            multi_line: flags.contains('m'),
            dot_all: flags.contains('s'),
        }
    }

    fn inline(&self) -> String {
        let mut inline = String::from("(?R");
        if self.ignore_case {
            inline.push('i');
        }
        if self.multi_line {
            inline.push('m');
        }
        if self.dot_all {
            inline.push('s');
        }
        inline.push(')');
        inline
    }
}

enum Engine {
    Regex(regex::Regex),
    Fancy(fancy_regex::Regex),
}

/// A compiled JavaScript pattern.
pub struct JsRegex {
    engine: Engine,
    pub flags: Flags,
    /// Standard-engine pattern with its flags inline, for `RegexSet`s.
    inline: Option<String>,
}

/// One match: overall span and capture-group spans, as byte offsets.
pub struct Match {
    pub start: usize,
    pub end: usize,
    groups: Vec<Option<(usize, usize)>>,
}

impl Match {
    pub fn group(&self, index: usize) -> Option<(usize, usize)> {
        self.groups.get(index).copied().flatten()
    }
}

impl JsRegex {
    pub fn new(pattern: &str, flags: &str) -> Result<Self, String> {
        let flags = Flags::parse(flags);
        let translated = translate(pattern, Target::Regex);
        let standard = regex::RegexBuilder::new(&translated)
            .case_insensitive(flags.ignore_case)
            .multi_line(flags.multi_line)
            .dot_matches_new_line(flags.dot_all)
            .crlf(true)
            .size_limit(32 * 1024 * 1024)
            .build();
        let mut inline = None;
        let engine = match standard {
            Ok(regex) => {
                inline = Some(format!("{}{}", flags.inline(), translated));
                Engine::Regex(regex)
            }
            Err(standard_error) => {
                let fancy = format!("{}{}", flags.inline(), translate(pattern, Target::Fancy));
                match fancy_regex::Regex::new(&fancy) {
                    Ok(regex) => Engine::Fancy(regex),
                    Err(fancy_error) => {
                        return Err(format!(
                            "unsupported pattern: {standard_error}; {fancy_error}"
                        ))
                    }
                }
            }
        };
        Ok(Self {
            engine,
            flags,
            inline,
        })
    }

    /// Whether the fast `regex` engine runs this pattern (not the fallback).
    pub fn is_standard(&self) -> bool {
        matches!(self.engine, Engine::Regex(_))
    }

    /// The pattern with inline flags when the standard engine runs it.
    pub fn set_pattern(&self) -> Option<&str> {
        self.inline.as_deref()
    }

    pub fn is_match(&self, text: &str) -> bool {
        match &self.engine {
            Engine::Regex(regex) => regex.is_match(text),
            Engine::Fancy(regex) => regex.is_match(text).unwrap_or(false),
        }
    }

    /// Matches in order like a JavaScript `exec` loop: every match when
    /// global, otherwise only the first; empty matches are skipped.
    pub fn matches(&self, text: &str, with_groups: bool, mut visit: impl FnMut(Match)) {
        let global = self.flags.global;
        match &self.engine {
            Engine::Regex(regex) => {
                if with_groups {
                    for captures in regex.captures_iter(text) {
                        let whole = captures.get(0).unwrap();
                        if whole.start() == whole.end() {
                            continue;
                        }
                        visit(Match {
                            start: whole.start(),
                            end: whole.end(),
                            groups: captures
                                .iter()
                                .map(|group| group.map(|m| (m.start(), m.end())))
                                .collect(),
                        });
                        if !global {
                            return;
                        }
                    }
                } else {
                    for found in regex.find_iter(text) {
                        if found.start() == found.end() {
                            continue;
                        }
                        visit(Match {
                            start: found.start(),
                            end: found.end(),
                            groups: Vec::new(),
                        });
                        if !global {
                            return;
                        }
                    }
                }
            }
            Engine::Fancy(regex) => {
                for captures in regex.captures_iter(text) {
                    let Ok(captures) = captures else { return };
                    let whole = captures.get(0).unwrap();
                    if whole.start() == whole.end() {
                        continue;
                    }
                    visit(Match {
                        start: whole.start(),
                        end: whole.end(),
                        groups: captures
                            .iter()
                            .map(|group| group.map(|m| (m.start(), m.end())))
                            .collect(),
                    });
                    if !global {
                        return;
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn starts(regex: &JsRegex, text: &str) -> Vec<usize> {
        let mut starts = Vec::new();
        regex.matches(text, false, |m| starts.push(m.start));
        starts
    }

    #[test]
    fn word_boundaries_and_classes_are_ascii_like_javascript() {
        let text = "中文error x error";
        let standard = JsRegex::new(r"\b(error)\b", "g").unwrap();
        assert!(standard.is_standard());
        assert_eq!(starts(&standard, text), [6, 14]);
        let fancy = JsRegex::new(r"\b(error)\b(?!s)", "g").unwrap();
        assert!(!fancy.is_standard());
        assert_eq!(starts(&fancy, text), [6, 14]);
        assert_eq!(starts(&JsRegex::new(r"\w+", "g").unwrap(), "中ab"), [3]);
        assert_eq!(
            starts(&JsRegex::new(r"[^\w$]x", "g").unwrap(), "中x$x"),
            [0]
        );
    }

    #[test]
    fn line_terminators_flags_and_escapes() {
        let multi = JsRegex::new(r"^a$", "gm").unwrap();
        assert_eq!(starts(&multi, "a\r\na\r\n"), [0, 3]);
        assert!(JsRegex::new(r"a.b", "").unwrap().matches_none("a\rb"));
        assert_eq!(starts(&JsRegex::new("[^]", "g").unwrap(), "\n"), [0]);
        assert_eq!(starts(&JsRegex::new(r"\u0041\/", "g").unwrap(), "A/"), [0]);
        assert_eq!(starts(&JsRegex::new("[a&b]", "g").unwrap(), "&"), [0]);
        assert_eq!(starts(&JsRegex::new("x", "gi").unwrap(), "X"), [0]);
        let first_only = JsRegex::new("x", "").unwrap();
        assert_eq!(starts(&first_only, "xx"), [0]);
        assert!(JsRegex::new("(", "g").is_err());
    }

    impl JsRegex {
        fn matches_none(&self, text: &str) -> bool {
            !self.is_match(text)
        }
    }
}
