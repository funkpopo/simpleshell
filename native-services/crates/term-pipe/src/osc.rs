//! OSC-safe transform, as `oscSafeOutput.js`: visible text is transformed,
//! OSC sequences (titles, hyperlinks, cwd reports) pass through unchanged,
//! including when they span chunks. Only a trailing ESC is ever held back.

#[derive(Default)]
pub struct OscFilter {
    in_osc: bool,
    osc_escape: bool,
    pending_escape: bool,
}

const OSC_END: [&str; 5] = ["\x07", "\x1b\\", "\u{9c}", "\x18", "\x1a"];
const OSC_START: [&str; 2] = ["\x1b]", "\u{9d}"];

/// Leftmost occurrence of any needle (earlier needles win ties).
fn find_first(text: &str, needles: &[&str]) -> Option<(usize, usize)> {
    needles
        .iter()
        .filter_map(|needle| text.find(needle).map(|at| (at, needle.len())))
        .min_by_key(|(at, _)| *at)
}

impl OscFilter {
    pub fn transform(
        &mut self,
        data: &str,
        is_final: bool,
        mut visible: impl FnMut(&str) -> String,
    ) -> String {
        let joined;
        let mut data: &str = data;
        if self.pending_escape {
            self.pending_escape = false;
            joined = format!("\x1b{data}");
            data = &joined;
        }
        let mut out = String::with_capacity(data.len());
        while !data.is_empty() {
            if self.in_osc {
                let end = if self.osc_escape && data.starts_with('\\') {
                    Some((0, 1))
                } else {
                    find_first(data, &OSC_END)
                };
                self.osc_escape = false;
                let Some((at, length)) = end else {
                    out.push_str(data);
                    self.osc_escape = data.ends_with('\x1b');
                    break;
                };
                out.push_str(&data[..at + length]);
                data = &data[at + length..];
                self.in_osc = false;
            } else {
                let Some((at, length)) = find_first(data, &OSC_START) else {
                    let mut text = data;
                    if !is_final && text.ends_with('\x1b') {
                        self.pending_escape = true;
                        text = &text[..text.len() - 1];
                    }
                    if !text.is_empty() {
                        out.push_str(&visible(text));
                    }
                    break;
                };
                if at > 0 {
                    out.push_str(&visible(&data[..at]));
                }
                out.push_str(&data[at..at + length]);
                data = &data[at + length..];
                self.in_osc = true;
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn upper(text: &str) -> String {
        text.to_uppercase()
    }

    #[test]
    fn transforms_only_visible_text_across_chunks() {
        let mut filter = OscFilter::default();
        let mut out = filter.transform("ab\x1b]0;ti", false, upper);
        out += &filter.transform("tle\x07cd\x1b", false, upper);
        out += &filter.transform("]8;;x\x1b", false, upper);
        out += &filter.transform("\\ef", true, upper);
        assert_eq!(out, "AB\x1b]0;title\x07CD\x1b]8;;x\x1b\\EF");
    }
}
