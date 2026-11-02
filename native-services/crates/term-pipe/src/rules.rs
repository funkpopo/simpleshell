//! Highlight rule definitions (the shape of `highlight-configs.js`), their
//! compilation and validation.

use crate::pattern::JsRegex;
use serde::Deserialize;

pub(crate) const RESET: &str = "\x1b[0m";

/// A rule as configured in `highlight-configs.js` or by the user.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleConfig {
    pub id: Option<String>,
    pub name: Option<String>,
    #[serde(rename = "type")]
    pub kind: Option<String>,
    #[serde(default)]
    pub enabled: bool,
    pub pattern: Option<String>,
    pub flags: Option<String>,
    pub style: Option<String>,
    pub group_index: Option<serde_json::Value>,
    pub priority: Option<serde_json::Value>,
    /// Keyword -> color, in definition order (alternation order matters).
    pub items: Option<serde_json::Map<String, serde_json::Value>>,
    pub requires: Option<Requirements>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Requirements {
    #[serde(default)]
    pub hex_run: Option<f64>,
    #[serde(default)]
    pub hex_run_before_dash: Option<f64>,
    #[serde(default)]
    pub ipv6_shape: bool,
    #[serde(default)]
    pub mac_shape: bool,
    #[serde(default)]
    pub upper_assign: bool,
    pub any_char: Option<String>,
    #[serde(default)]
    pub digit: bool,
}

fn ansi_named(name: &str) -> Option<&'static str> {
    Some(match name {
        "black" => "\x1b[30m",
        "red" => "\x1b[31m",
        "green" => "\x1b[32m",
        "yellow" => "\x1b[33m",
        "blue" => "\x1b[34m",
        "magenta" => "\x1b[35m",
        "cyan" => "\x1b[36m",
        "white" => "\x1b[37m",
        "reset" => RESET,
        "brightBlack" => "\x1b[90m",
        "brightRed" => "\x1b[91m",
        "brightGreen" => "\x1b[92m",
        "brightYellow" => "\x1b[93m",
        "brightBlue" => "\x1b[94m",
        "brightMagenta" => "\x1b[95m",
        "brightCyan" => "\x1b[96m",
        "brightWhite" => "\x1b[97m",
        "bold" => "\x1b[1m",
        "dim" => "\x1b[2m",
        "italic" => "\x1b[3m",
        "underline" => "\x1b[4m",
        _ => return None,
    })
}

fn color_alias(name: &str) -> Option<&'static str> {
    let named = match name {
        "red" => "red",
        "green" => "green",
        "blue" => "blue",
        "yellow" | "orange" => "yellow",
        "cyan" => "cyan",
        "magenta" | "purple" => "magenta",
        "grey" => "brightBlack",
        "lightgreen" => "brightGreen",
        "lightcoral" => "brightRed",
        "#FF6347" => "brightRed",
        "#61affe" => "brightBlue",
        "#49cc90" => "brightGreen",
        "#fca130" => "yellow",
        "#f93e3e" => "red",
        "#50e3c2" => "cyan",
        "#0d5aa7" | "#4682B4" => "blue",
        "#DDA0DD" => "magenta",
        "#98FB98" => "green",
        "#20B2AA" => "cyan",
        "#FF7F50" => "red",
        "#F0E68C" => "yellow",
        "#5F9EA0" => "cyan",
        "#FFD700" => "brightYellow",
        "#ff7b72" => "brightRed",
        "#d29922" => "brightYellow",
        "#3fb950" => "brightGreen",
        "#58a6ff" => "brightBlue",
        "#bc8cff" => "brightMagenta",
        "#39c5cf" => "brightCyan",
        "#ffa198" => "brightRed",
        "#79c0ff" => "brightBlue",
        "#6e7681" => "brightBlack",
        "#56d364" => "brightGreen",
        "#e3b341" => "brightYellow",
        "#d2a8ff" => "brightMagenta",
        "#a5d6ff" => "brightCyan",
        _ => return None,
    };
    ansi_named(named)
}

/// `resolveAnsiColor`: known names and hex aliases, otherwise reset.
pub(crate) fn resolve_ansi_color(color: &str) -> &'static str {
    let normalized = color.trim();
    if normalized.is_empty() {
        return RESET;
    }
    color_alias(normalized)
        .or_else(|| ansi_named(normalized))
        .unwrap_or(RESET)
}

fn find_ignore_case(haystack: &str, needle: &str) -> Option<usize> {
    haystack
        .to_ascii_lowercase()
        .find(&needle.to_ascii_lowercase())
}

/// `/<prefix>\s*<value>/i` where `\s*` may be empty.
fn style_has(style: &str, prefix: &str, value: &str) -> bool {
    let lower = style.to_ascii_lowercase();
    let mut from = 0;
    while let Some(found) = lower[from..].find(prefix) {
        let rest = lower[from + found + prefix.len()..].trim_start();
        if rest.starts_with(value) {
            return true;
        }
        from += found + prefix.len();
    }
    false
}

/// `parseStyleToFormat`: color plus bold / underline prefixes.
pub(crate) fn parse_style(style: Option<&str>) -> (&'static str, String) {
    let Some(style) = style else {
        return (RESET, String::new());
    };
    let mut color = RESET;
    if let Some(at) = find_ignore_case(style, "color:") {
        let value = style[at + "color:".len()..].trim_start();
        let value: String = value.chars().take_while(|c| *c != ';').collect();
        if !value.is_empty() {
            color = resolve_ansi_color(&value);
        }
    }
    let mut format = String::new();
    if style_has(style, "font-weight:", "bold") {
        format.push_str("\x1b[1m");
    }
    if style_has(style, "text-decoration:", "underline") {
        format.push_str("\x1b[4m");
    }
    (color, format)
}

// --- `requires` prefilter -------------------------------------------------

const TRACKED_CHARS: &str = ".:-\"~/\\=$";

fn tracked_bit(c: char) -> u16 {
    TRACKED_CHARS
        .chars()
        .position(|tracked| tracked == c)
        .map(|index| 1u16 << index)
        .unwrap_or(0)
}

const DIGIT_BIT: u16 = 1 << 9;

#[derive(Debug, Default, Clone, Copy)]
pub(crate) struct Features {
    max_hex_run: usize,
    max_hex_run_before_dash: usize,
    char_mask: u16,
    ipv6_shape: bool,
    mac_shape: bool,
    upper_assign: bool,
}

/// One pass over `text` computing what each rule's `requires` checks.
pub(crate) fn scan_features(text: &str) -> Features {
    let mut run = 0usize;
    let mut features = Features::default();
    let mut group_chain = 0usize;
    let mut max_group_chain = 0usize;
    let mut mac_chain = 0usize;
    let mut max_mac_chain = 0usize;
    let mut double_colon = false;
    let mut previous_was_colon = false;
    let mut previous: Option<char> = None;

    for c in text.chars() {
        let is_hex_letter = c.is_ascii_hexdigit() && !c.is_ascii_digit();
        if is_hex_letter || c.is_ascii_digit() {
            if c.is_ascii_digit() {
                features.char_mask |= DIGIT_BIT;
            }
            run += 1;
            previous_was_colon = false;
            previous = Some(c);
            continue;
        }
        features.max_hex_run = features.max_hex_run.max(run);
        if c == ':' || c == '-' {
            features.char_mask |= tracked_bit(c);
            if run >= 2 {
                mac_chain = if run == 2 && mac_chain > 0 {
                    mac_chain + 1
                } else {
                    1
                };
                max_mac_chain = max_mac_chain.max(mac_chain);
            } else {
                mac_chain = 0;
            }
            if c == ':' {
                if previous_was_colon {
                    double_colon = true;
                }
                if run > 0 {
                    group_chain = if run <= 4 && group_chain > 0 {
                        group_chain + 1
                    } else {
                        1
                    };
                    max_group_chain = max_group_chain.max(group_chain);
                } else {
                    group_chain = 0;
                }
                previous_was_colon = true;
            } else {
                features.max_hex_run_before_dash = features.max_hex_run_before_dash.max(run);
                group_chain = 0;
                previous_was_colon = false;
            }
        } else {
            let bit = tracked_bit(c);
            if bit != 0 {
                features.char_mask |= bit;
                if c == '=' && !features.upper_assign {
                    features.upper_assign = previous
                        .is_some_and(|p| p.is_ascii_uppercase() || p.is_ascii_digit() || p == '_');
                }
            }
            mac_chain = 0;
            group_chain = 0;
            previous_was_colon = false;
        }
        run = 0;
        previous = Some(c);
    }
    features.max_hex_run = features.max_hex_run.max(run);
    features.ipv6_shape = double_colon || max_group_chain >= 6;
    features.mac_shape = max_mac_chain >= 5;
    features
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct CompiledRequirements {
    hex_run: usize,
    hex_run_before_dash: usize,
    ipv6_shape: bool,
    mac_shape: bool,
    upper_assign: bool,
    any_char_mask: u16,
    digit: bool,
}

impl CompiledRequirements {
    fn compile(requires: &Requirements) -> Option<Self> {
        let any_char_mask = requires
            .any_char
            .as_deref()
            .filter(|chars| !chars.is_empty())
            .map(|chars| {
                let mut mask = 0u16;
                for c in chars.chars() {
                    let bit = tracked_bit(c);
                    if bit == 0 {
                        return 0; // untracked: drop the condition
                    }
                    mask |= bit;
                }
                mask
            })
            .unwrap_or(0);
        let compiled = Self {
            hex_run: requires.hex_run.unwrap_or(0.0).max(0.0) as usize,
            hex_run_before_dash: requires.hex_run_before_dash.unwrap_or(0.0).max(0.0) as usize,
            ipv6_shape: requires.ipv6_shape,
            mac_shape: requires.mac_shape,
            upper_assign: requires.upper_assign,
            any_char_mask,
            digit: requires.digit,
        };
        let any = compiled.hex_run > 0
            || compiled.hex_run_before_dash > 0
            || compiled.ipv6_shape
            || compiled.mac_shape
            || compiled.upper_assign
            || compiled.any_char_mask != 0
            || compiled.digit;
        any.then_some(compiled)
    }

    pub(crate) fn met_by(&self, features: &Features) -> bool {
        features.max_hex_run >= self.hex_run
            && features.max_hex_run_before_dash >= self.hex_run_before_dash
            && (!self.ipv6_shape || features.ipv6_shape)
            && (!self.mac_shape || features.mac_shape)
            && (!self.upper_assign || features.upper_assign)
            && (self.any_char_mask == 0 || features.char_mask & self.any_char_mask != 0)
            && (!self.digit || features.char_mask & DIGIT_BIT != 0)
    }
}

// --- compilation ------------------------------------------------------------

pub(crate) enum RuleKind {
    Keyword {
        colors: Vec<(String, &'static str)>,
        prefilter: aho_corasick::AhoCorasick,
    },
    Regex {
        color: &'static str,
        format: String,
        group_index: Option<usize>,
    },
}

pub(crate) struct CompiledRule {
    pub regex: JsRegex,
    pub kind: RuleKind,
    pub requires: Option<CompiledRequirements>,
    pub priority: f64,
    pub order: usize,
}

fn number(value: &serde_json::Value) -> Option<f64> {
    match value {
        serde_json::Value::Number(number) => number.as_f64(),
        serde_json::Value::String(text) => text.trim().parse().ok(),
        serde_json::Value::Bool(flag) => Some(f64::from(u8::from(*flag))),
        _ => None,
    }
}

fn compile_rule(
    rule: &RuleConfig,
    order: usize,
    total: usize,
) -> Result<Option<CompiledRule>, String> {
    let priority = rule
        .priority
        .as_ref()
        .and_then(number)
        .filter(|p| p.is_finite())
        .unwrap_or((total - order) as f64);
    match rule.kind.as_deref() {
        Some("keyword") => {
            let Some(items) = rule.items.as_ref().filter(|items| !items.is_empty()) else {
                return Ok(None);
            };
            let keywords: Vec<&String> = items.keys().collect();
            let alternatives: Vec<String> = keywords
                .iter()
                .map(|keyword| regex::escape(keyword))
                .collect();
            let regex = JsRegex::new(&format!(r"\b({})\b", alternatives.join("|")), "gi")?;
            let prefilter = aho_corasick::AhoCorasick::builder()
                .ascii_case_insensitive(true)
                .build(&keywords)
                .map_err(|error| error.to_string())?;
            let colors = items
                .iter()
                .map(|(keyword, color)| {
                    (
                        keyword.to_lowercase(),
                        resolve_ansi_color(color.as_str().unwrap_or_default()),
                    )
                })
                .collect();
            Ok(Some(CompiledRule {
                regex,
                kind: RuleKind::Keyword { colors, prefilter },
                requires: None,
                priority,
                order,
            }))
        }
        Some("regex") => {
            let Some(pattern) = rule.pattern.as_deref().filter(|p| !p.is_empty()) else {
                return Ok(None);
            };
            let mut flags = rule.flags.clone().unwrap_or_default();
            if !flags.contains('g') {
                flags.push('g');
            }
            let regex = JsRegex::new(pattern, &flags)?;
            let (color, format) = parse_style(rule.style.as_deref());
            let group_index = rule
                .group_index
                .as_ref()
                .and_then(number)
                .filter(|index| index.fract() == 0.0 && *index > 0.0)
                .map(|index| index as usize);
            Ok(Some(CompiledRule {
                regex,
                kind: RuleKind::Regex {
                    color,
                    format,
                    group_index,
                },
                requires: rule
                    .requires
                    .as_ref()
                    .and_then(CompiledRequirements::compile),
                priority,
                order,
            }))
        }
        _ => Ok(None),
    }
}

/// Compiles enabled rules in order; rules that fail to compile are skipped,
/// as `OutputProcessor.updateHighlightRules` does.
pub(crate) fn compile_rules(rules: &[RuleConfig]) -> Vec<CompiledRule> {
    rules
        .iter()
        .filter(|rule| rule.enabled)
        .enumerate()
        .filter_map(|(order, rule)| compile_rule(rule, order, rules.len()).ok().flatten())
        .collect()
}

/// Validation result for one rule, for rejecting rules at save time.
#[derive(Debug, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuleCheck {
    pub index: usize,
    pub id: Option<String>,
    pub valid: bool,
    /// `regex`, or `fancy-regex` when the pattern needs lookaround.
    pub engine: Option<&'static str>,
    pub error: Option<String>,
}

pub fn validate_rules(rules: &[RuleConfig]) -> Vec<RuleCheck> {
    rules
        .iter()
        .enumerate()
        .map(|(index, rule)| {
            let id = rule.id.clone().or_else(|| rule.name.clone());
            match compile_rule(rule, 0, rules.len()) {
                Ok(Some(compiled)) => RuleCheck {
                    index,
                    id,
                    valid: true,
                    engine: Some(if compiled.regex.is_standard() {
                        "regex"
                    } else {
                        "fancy-regex"
                    }),
                    error: None,
                },
                Ok(None) => RuleCheck {
                    index,
                    id,
                    valid: false,
                    engine: None,
                    error: Some("rule needs a type with a pattern or keywords".into()),
                },
                Err(error) => RuleCheck {
                    index,
                    id,
                    valid: false,
                    engine: None,
                    error: Some(error),
                },
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn styles_resolve_like_parse_style_to_format() {
        assert_eq!(
            parse_style(Some("color: cyan;")),
            ("\x1b[36m", String::new())
        );
        assert_eq!(
            parse_style(Some(
                "color: #FF6347; font-weight: bold; text-decoration:underline"
            )),
            ("\x1b[91m", "\x1b[1m\x1b[4m".to_string())
        );
        assert_eq!(parse_style(Some("color: unknown")), (RESET, String::new()));
        assert_eq!(parse_style(None), (RESET, String::new()));
    }

    #[test]
    fn features_detect_shapes() {
        let f = scan_features("fe80::1 aa:bb:cc:dd:ee:ff PATH=x 550e8400-e29b");
        assert!(f.ipv6_shape && f.mac_shape && f.upper_assign);
        assert_eq!(f.max_hex_run_before_dash, 8);
        assert!(!scan_features("plain words").ipv6_shape);
    }

    #[test]
    fn validation_reports_engines_and_errors() {
        let rules: Vec<RuleConfig> = serde_json::from_str(
            r#"[
                {"type":"regex","enabled":true,"pattern":"\\d+"},
                {"type":"regex","enabled":true,"pattern":"(?<=x)y"},
                {"type":"regex","enabled":true,"pattern":"("},
                {"type":"keyword","enabled":true,"items":{}}
            ]"#,
        )
        .unwrap();
        let checks = validate_rules(&rules);
        assert_eq!(checks[0].engine, Some("regex"));
        assert_eq!(checks[1].engine, Some("fancy-regex"));
        assert!(!checks[2].valid && checks[2].error.is_some());
        assert!(!checks[3].valid);
    }
}
