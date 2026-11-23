//! Syntax highlighting of terminal output, equivalent to
//! `OutputProcessor.applySyntaxHighlighting` in the main process.
//!
//! Text between ANSI sequences is highlighted only while no SGR style is
//! active. Each segment runs the rules whose prefilters pass: the `requires`
//! feature scan, a `RegexSet` over all `regex`-engine rules, and an
//! Aho-Corasick scan for keyword rules. Overlapping matches are resolved by
//! priority, length, rule order and position.

use crate::rules::{compile_rules, scan_features, CompiledRule, RuleConfig, RuleKind, RESET};
use regex::Regex;
use std::borrow::Cow;
use std::sync::OnceLock;

fn ansi_sequence() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"\x1b(?:\[[0-9;?]*[ -/]*[@-~]|[@-Z\x5C-_])").unwrap())
}

fn osc_sequence() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"(?s)\x1b\].*?(?:\x07|\x1b\\)").unwrap())
}

#[inline]
fn is_host_ident_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'.' || b == b'-'
}

/// `(@host)-<hex>` before `:`, `#` or whitespace: hostnames with a random
/// suffix (container shells) lose the suffix, as in the main process.
fn strip_host_suffix(text: &str) -> Cow<'_, str> {
    let bytes = text.as_bytes();
    if !bytes.contains(&b'@') || !bytes.contains(&b'-') {
        return Cow::Borrowed(text);
    }
    let mut out: Option<String> = None;
    let mut cursor = 0;
    let mut pos = 0;
    while let Some(rel) = bytes[pos..].iter().position(|&b| b == b'@') {
        let at = pos + rel;
        let mut end = at + 1;
        while end < bytes.len() && is_host_ident_byte(bytes[end]) {
            end += 1;
        }
        if end == at + 1 || end >= bytes.len() {
            pos = end;
            continue;
        }
        let next = bytes[end];
        let boundary = if next < 128 {
            matches!(
                next,
                b':' | b'#' | b'\t' | b'\n' | b'\x0b' | b'\x0c' | b'\r' | b' '
            )
        } else {
            text[end..].chars().next().is_some_and(js_whitespace)
        };
        if !boundary {
            pos = end;
            continue;
        }
        let mut hex_start = end;
        while hex_start > at + 1 && bytes[hex_start - 1].is_ascii_hexdigit() {
            hex_start -= 1;
        }
        let hex_len = end - hex_start;
        if (6..=16).contains(&hex_len) && hex_start > at + 1 && bytes[hex_start - 1] == b'-' {
            let dash = hex_start - 1;
            let buf = out.get_or_insert_with(|| String::with_capacity(text.len()));
            buf.push_str(&text[cursor..dash]);
            cursor = end;
        }
        pos = end;
    }
    match out {
        Some(mut buf) => {
            buf.push_str(&text[cursor..]);
            Cow::Owned(buf)
        }
        None => Cow::Borrowed(text),
    }
}

const STYLE_CLEAR_CODES: [f64; 11] = [
    0.0, 22.0, 23.0, 24.0, 25.0, 27.0, 28.0, 29.0, 39.0, 49.0, 59.0,
];

/// Style state after an SGR sequence (`ESC [ digits/semicolons m`), or
/// `None` for other sequences. Empty fields count as 0; fields that overflow
/// to infinity are ignored.
fn sgr_style_active(sequence: &str) -> Option<bool> {
    let bytes = sequence.as_bytes();
    if bytes.len() < 3 || bytes[1] != b'[' || bytes[bytes.len() - 1] != b'm' {
        return None;
    }
    let body = &sequence[2..sequence.len() - 1];
    if !body.bytes().all(|b| b.is_ascii_digit() || b == b';') {
        return None;
    }
    let mut active = false;
    for field in body.split(';') {
        let value = if field.is_empty() {
            0.0
        } else {
            field.parse::<f64>().unwrap_or(f64::INFINITY)
        };
        if value.is_finite() && !STYLE_CLEAR_CODES.contains(&value) {
            active = true;
        }
    }
    Some(active)
}

/// JavaScript's `\s` set.
fn js_whitespace(c: char) -> bool {
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

#[derive(Debug, Clone, Copy)]
struct Candidate<'a> {
    start: usize,
    end: usize,
    priority: f64,
    order: usize,
    format: &'a str,
    color: &'static str,
}

#[derive(Default)]
struct HighlightScratch<'a> {
    candidates: Vec<Candidate<'a>>,
    selected: Vec<Candidate<'a>>,
    greedy_sorted: Vec<Candidate<'a>>,
    greedy_selected: Vec<Candidate<'a>>,
}

#[inline]
fn ascii_word_boundary(text: &str, start: usize, end: usize) -> Option<bool> {
    let bytes = text.as_bytes();
    if start > 0 {
        let prev = bytes[start - 1];
        if prev >= 128 {
            return None;
        }
        if prev.is_ascii_alphanumeric() || prev == b'_' {
            return Some(false);
        }
    }
    if end < bytes.len() {
        let next = bytes[end];
        if next >= 128 {
            return None;
        }
        if next.is_ascii_alphanumeric() || next == b'_' {
            return Some(false);
        }
    }
    Some(true)
}

#[inline]
fn is_js_whitespace_only(text: &str) -> bool {
    if text
        .as_bytes()
        .iter()
        .all(|&b| matches!(b, b'\t' | b'\n' | b'\x0b' | b'\x0c' | b'\r' | b' '))
    {
        return true;
    }
    !text.is_ascii() && text.chars().all(js_whitespace)
}

pub struct Highlighter {
    rules: Vec<CompiledRule>,
    /// Patterns of `regex`-engine rules (not handled by `exact_ac`) and the rule index of each.
    set: Option<(regex::RegexSet, Vec<usize>)>,
}

impl Highlighter {
    pub fn new(rules: &[RuleConfig]) -> Self {
        let rules = compile_rules(rules);
        let standard: Vec<(usize, &str)> = rules
            .iter()
            .enumerate()
            .filter_map(|(index, rule)| {
                if !rule.in_set {
                    return None;
                }
                rule.regex.set_pattern().map(|pattern| (index, pattern))
            })
            .collect();
        let set = if standard.is_empty() {
            None
        } else {
            regex::RegexSetBuilder::new(standard.iter().map(|(_, pattern)| *pattern))
                .size_limit(64 * 1024 * 1024)
                .build()
                .ok()
                .map(|set| (set, standard.iter().map(|(index, _)| *index).collect()))
        };
        Self { rules, set }
    }

    pub fn is_empty(&self) -> bool {
        self.rules.is_empty()
    }

    fn collect_candidates<'a>(&'a self, text: &str, candidates: &mut Vec<Candidate<'a>>) {
        candidates.clear();
        let mut features = None;
        let bytes = text.as_bytes();

        if self.rules.len() <= 64 {
            let mut possible_mask = if let Some((set, indices)) = &self.set {
                let mut mask = if self.rules.len() == 64 {
                    !0u64
                } else {
                    (1u64 << self.rules.len()) - 1
                };
                for &index in indices {
                    mask &= !(1u64 << index);
                }
                for matched in set.matches(text).iter() {
                    mask |= 1u64 << indices[matched];
                }
                mask
            } else if self.rules.len() == 64 {
                !0u64
            } else {
                (1u64 << self.rules.len()) - 1
            };

            while possible_mask != 0 {
                let index = possible_mask.trailing_zeros() as usize;
                possible_mask &= possible_mask - 1;
                let rule = &self.rules[index];
                if let Some(requires) = &rule.requires {
                    if !requires.quick_possible(bytes) {
                        continue;
                    }
                    let features = features.get_or_insert_with(|| scan_features(text));
                    if !requires.met_by(features) {
                        continue;
                    }
                }
                self.collect_rule_candidates(rule, text, candidates);
            }
            return;
        }

        let possible: Option<Vec<bool>> = self.set.as_ref().map(|(set, indices)| {
            let mut possible = vec![true; self.rules.len()];
            for index in indices {
                possible[*index] = false;
            }
            for matched in set.matches(text).iter() {
                possible[indices[matched]] = true;
            }
            possible
        });

        for (index, rule) in self.rules.iter().enumerate() {
            if possible.as_ref().is_some_and(|possible| !possible[index]) {
                continue;
            }
            if let Some(requires) = &rule.requires {
                if !requires.quick_possible(bytes) {
                    continue;
                }
                let features = features.get_or_insert_with(|| scan_features(text));
                if !requires.met_by(features) {
                    continue;
                }
            }
            self.collect_rule_candidates(rule, text, candidates);
        }
    }

    fn collect_rule_candidates<'a>(
        &'a self,
        rule: &'a CompiledRule,
        text: &str,
        candidates: &mut Vec<Candidate<'a>>,
    ) {
        match &rule.kind {
            RuleKind::Keyword {
                colors,
                prefilter,
                exact_ac,
            } => {
                if let Some((ac, pattern_colors)) = exact_ac {
                    let saved_len = candidates.len();
                    let mut needs_regex_fallback = false;
                    for found in ac.find_iter(text) {
                        match ascii_word_boundary(text, found.start(), found.end()) {
                            Some(true) => {
                                candidates.push(Candidate {
                                    start: found.start(),
                                    end: found.end(),
                                    priority: rule.priority,
                                    order: rule.order,
                                    format: "",
                                    color: pattern_colors[found.pattern().as_usize()],
                                });
                            }
                            Some(false) => {}
                            None => {
                                needs_regex_fallback = true;
                                break;
                            }
                        }
                    }
                    if !needs_regex_fallback {
                        return;
                    }
                    candidates.truncate(saved_len);
                } else if !prefilter.is_match(text) {
                    return;
                }
                rule.regex.matches(text, false, |found| {
                    let matched = text[found.start..found.end].to_lowercase();
                    if let Some((_, color)) = colors.iter().find(|(keyword, _)| *keyword == matched)
                    {
                        candidates.push(Candidate {
                            start: found.start,
                            end: found.end,
                            priority: rule.priority,
                            order: rule.order,
                            format: "",
                            color,
                        });
                    }
                });
            }
            RuleKind::Regex {
                color,
                format,
                group_index,
                exact_ac,
            } => {
                if let Some(ac) = exact_ac {
                    let saved_len = candidates.len();
                    let mut needs_regex_fallback = false;
                    for found in ac.find_iter(text) {
                        match ascii_word_boundary(text, found.start(), found.end()) {
                            Some(true) => {
                                candidates.push(Candidate {
                                    start: found.start(),
                                    end: found.end(),
                                    priority: rule.priority,
                                    order: rule.order,
                                    format: format.as_str(),
                                    color,
                                });
                            }
                            Some(false) => {}
                            None => {
                                needs_regex_fallback = true;
                                break;
                            }
                        }
                    }
                    if !needs_regex_fallback {
                        return;
                    }
                    candidates.truncate(saved_len);
                }
                rule.regex.matches(text, group_index.is_some(), |found| {
                    let (mut start, mut end) = (found.start, found.end);
                    if let Some(group) = group_index {
                        let Some((group_start, group_end)) = found.group(*group) else {
                            return;
                        };
                        if group_start == group_end {
                            return;
                        }
                        // The main process locates the group by text.
                        let target = &text[group_start..group_end];
                        let Some(relative) = text[found.start..found.end].find(target) else {
                            return;
                        };
                        start = found.start + relative;
                        end = start + target.len();
                    }
                    if end <= start || end > text.len() {
                        return;
                    }
                    candidates.push(Candidate {
                        start,
                        end,
                        priority: rule.priority,
                        order: rule.order,
                        format: format.as_str(),
                        color,
                    });
                });
            }
        }
    }

    fn select_greedy_into<'a>(
        cluster: &[Candidate<'a>],
        sorted: &mut Vec<Candidate<'a>>,
        selected: &mut Vec<Candidate<'a>>,
    ) {
        sorted.clear();
        sorted.extend_from_slice(cluster);
        sorted.sort_unstable_by(|a, b| {
            b.priority
                .partial_cmp(&a.priority)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then((b.end - b.start).cmp(&(a.end - a.start)))
                .then(a.order.cmp(&b.order))
                .then(a.start.cmp(&b.start))
        });
        selected.clear();
        for &candidate in sorted.iter() {
            let at = selected.partition_point(|range| range.start < candidate.start);
            let overlaps_previous = at > 0 && selected[at - 1].end > candidate.start;
            let overlaps_next = selected
                .get(at)
                .is_some_and(|next| next.start < candidate.end);
            if !overlaps_previous && !overlaps_next {
                selected.insert(at, candidate);
            }
        }
    }

    fn select_into<'a>(scratch: &mut HighlightScratch<'a>) {
        scratch.selected.clear();
        if scratch.candidates.is_empty() {
            return;
        }
        scratch
            .candidates
            .sort_unstable_by_key(|candidate| candidate.start);
        let mut cluster_start = 0;
        let mut cluster_end = scratch.candidates[0].end;
        let len = scratch.candidates.len();
        for index in 1..=len {
            if index < len && scratch.candidates[index].start < cluster_end {
                cluster_end = cluster_end.max(scratch.candidates[index].end);
                continue;
            }
            let cluster = &scratch.candidates[cluster_start..index];
            if cluster.len() == 1 {
                scratch.selected.push(cluster[0]);
            } else {
                Self::select_greedy_into(
                    cluster,
                    &mut scratch.greedy_sorted,
                    &mut scratch.greedy_selected,
                );
                scratch.selected.extend_from_slice(&scratch.greedy_selected);
            }
            if index < len {
                cluster_start = index;
                cluster_end = scratch.candidates[index].end;
            }
        }
    }

    fn highlight_segment<'a>(
        &'a self,
        text: &str,
        scratch: &mut HighlightScratch<'a>,
        out: &mut String,
    ) {
        if is_js_whitespace_only(text) {
            out.push_str(text);
            return;
        }
        self.collect_candidates(text, &mut scratch.candidates);
        if scratch.candidates.is_empty() {
            out.push_str(text);
            return;
        }
        Self::select_into(scratch);
        let mut cursor = 0;
        for &range in &scratch.selected {
            out.push_str(&text[cursor..range.start]);
            out.push_str(range.format);
            out.push_str(range.color);
            out.push_str(&text[range.start..range.end]);
            out.push_str(RESET);
            cursor = range.end;
        }
        out.push_str(&text[cursor..]);
    }

    fn highlight_isolated(&self, output: &str, has_esc: bool) -> String {
        let mut scratch = HighlightScratch::default();
        let mut out = String::with_capacity(output.len() + output.len() / 8);
        if !has_esc {
            self.highlight_segment(output, &mut scratch, &mut out);
            return out;
        }
        let mut cursor = 0;
        let mut style_active = false;
        for sequence in ansi_sequence().find_iter(output) {
            if sequence.start() > cursor {
                let segment = &output[cursor..sequence.start()];
                if style_active {
                    out.push_str(segment);
                } else {
                    self.highlight_segment(segment, &mut scratch, &mut out);
                }
            }
            out.push_str(sequence.as_str());
            if let Some(active) = sgr_style_active(sequence.as_str()) {
                style_active = active;
            }
            cursor = sequence.end();
        }
        let rest = &output[cursor..];
        if style_active {
            out.push_str(rest);
        } else {
            self.highlight_segment(rest, &mut scratch, &mut out);
        }
        out
    }

    /// Highlights `output` exactly like the main process's
    /// `applySyntaxHighlighting`.
    pub fn apply(&self, output: &str) -> String {
        if output.is_empty() || self.rules.is_empty() {
            return output.to_string();
        }
        let has_esc = output.contains('\x1b');
        let has_osc = has_esc && output.contains("\x1b]");
        if !has_osc {
            let stripped = strip_host_suffix(output);
            return self.highlight_isolated(stripped.as_ref(), has_esc);
        }
        let mut placeholders: Vec<(String, String)> = Vec::new();
        let mut text = String::with_capacity(output.len());
        let mut cursor = 0;
        for osc in osc_sequence().find_iter(output) {
            text.push_str(&output[cursor..osc.start()]);
            let token = format!("__OSC_PLACEHOLDER_{}__", placeholders.len());
            text.push_str(&token);
            placeholders.push((token, strip_host_suffix(osc.as_str()).into_owned()));
            cursor = osc.end();
        }
        text.push_str(&output[cursor..]);

        let stripped = strip_host_suffix(&text);
        let mut processed = self.highlight_isolated(stripped.as_ref(), stripped.contains('\x1b'));
        for (token, value) in placeholders {
            processed = replace_first_js(&processed, &token, &value);
        }
        processed
    }
}

/// `String.prototype.replace(string, string)`: first occurrence, with the
/// replacement's `$$`, `$&`, `` $` `` and `$'` patterns.
fn replace_first_js(text: &str, token: &str, replacement: &str) -> String {
    let Some(at) = text.find(token) else {
        return text.to_string();
    };
    let (before, after) = (&text[..at], &text[at + token.len()..]);
    let mut out = String::with_capacity(text.len() + replacement.len());
    out.push_str(before);
    let mut chars = replacement.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '$' {
            out.push(c);
            continue;
        }
        match chars.peek() {
            Some('$') => {
                out.push('$');
                chars.next();
            }
            Some('&') => {
                out.push_str(token);
                chars.next();
            }
            Some('`') => {
                out.push_str(before);
                chars.next();
            }
            Some('\'') => {
                out.push_str(after);
                chars.next();
            }
            _ => out.push('$'),
        }
    }
    out.push_str(after);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rules() -> Vec<RuleConfig> {
        serde_json::from_str(
            r#"[
              {"id":"ip","type":"regex","enabled":true,"requires":{"anyChar":".","digit":true},
               "pattern":"\\b(?:[0-9]{1,3}\\.){3}[0-9]{1,3}\\b","flags":"g","style":"color: cyan;"},
              {"id":"err","type":"regex","enabled":true,"pattern":"\\b(error|failed)\\b","flags":"gi",
               "style":"color: red; font-weight: bold;"},
              {"id":"kw","type":"keyword","enabled":true,"items":{"ok":"green"}}
            ]"#,
        )
        .unwrap()
    }

    #[test]
    fn highlights_matches_and_respects_active_sgr_styles() {
        let highlighter = Highlighter::new(&rules());
        assert_eq!(
            highlighter.apply("ip 10.0.0.1 OK"),
            "ip \x1b[36m10.0.0.1\x1b[0m \x1b[32mOK\x1b[0m"
        );
        // Styled text from the program itself is left alone.
        assert_eq!(
            highlighter.apply("\x1b[31merror\x1b[0m error"),
            "\x1b[31merror\x1b[0m \x1b[1m\x1b[31merror\x1b[0m"
        );
        assert_eq!(highlighter.apply("   \r\n"), "   \r\n");
    }

    #[test]
    fn osc_sequences_are_preserved_and_host_suffixes_stripped() {
        let highlighter = Highlighter::new(&rules());
        let title = "\x1b]0;root@box-a1b2c3d4: error $&\x07";
        assert_eq!(
            highlighter.apply(&format!("{title}root@box-a1b2c3d4:~# ")),
            "\x1b]0;root@box: error __OSC_PLACEHOLDER_0__\x07root@box:~# "
        );
    }

    #[test]
    fn sgr_parsing_matches_the_main_process() {
        assert_eq!(sgr_style_active("\x1b[0m"), Some(false));
        assert_eq!(sgr_style_active("\x1b[m"), Some(false));
        assert_eq!(sgr_style_active("\x1b[1;32m"), Some(true));
        assert_eq!(sgr_style_active("\x1b[38:5:1m"), None);
        assert_eq!(
            sgr_style_active(&format!("\x1b[{}m", "9".repeat(400))),
            Some(false)
        );
        assert_eq!(sgr_style_active("\x1b[K"), None);
    }
}
