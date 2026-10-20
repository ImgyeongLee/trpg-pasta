//! 텍스트(.txt, 붙여넣기)로 받은 시나리오의 줄을 문단으로 묶는다.
//!
//! PDF에서 복사해 온 텍스트처럼 줄이 강제로 꺾여 있으면 이어 붙이고,
//! 한 줄이 한 문단인 텍스트는 그대로 둔다.

use super::filters::{image_placeholder, is_page_number};
use super::layout::{Para, Unit, join_line};
use super::segment::is_terminator;
use super::vocab::Vocab;
use super::{ProcessOptions, Stats};

fn ends_sentence(line: &str) -> bool {
    let trimmed = line.trim_end_matches(|c: char| c.is_whitespace() || matches!(c, '"' | '\'' | '”' | '’' | '」' | '』' | ')'));
    trimmed.chars().last().is_some_and(|c| is_terminator(c) || c == '…')
}

pub struct TextLayout {
    pub units: Vec<Unit>,
    pub open: Option<Para>,
}

pub fn build_units(lines: &[String], carried: Option<Para>, opts: &ProcessOptions, stats: &mut Stats) -> TextLayout {
    let lengths: Vec<usize> = {
        let mut v: Vec<usize> = lines.iter().map(|l| l.trim().chars().count()).filter(|&n| n > 0).collect();
        v.sort_unstable();
        v
    };
    let p90 = lengths
        .get(((lengths.len() as f32 - 1.0) * 0.9).round().max(0.0) as usize)
        .copied()
        .unwrap_or(0);
    // 줄 길이가 고르면 강제 줄바꿈(wrap)된 텍스트로 본다.
    let wraps = |line: &str| p90 >= 20 && line.trim().chars().count() as f32 >= p90 as f32 * 0.75 && !ends_sentence(line);

    let vocab = Vocab::from_lines(lines.iter().map(String::as_str));
    let mut units = Vec::new();
    let mut open: Option<(Para, bool)> = carried.map(|p| (p, true));
    let close = |open: &mut Option<(Para, bool)>, units: &mut Vec<Unit>| {
        if let Some((p, _)) = open.take()
            && !p.text.trim().is_empty()
        {
            units.push(Unit::Para(p));
        }
    };

    for raw in lines {
        let line = raw.replace('\u{000C}', "");
        let text = line.trim();
        if text.is_empty() {
            close(&mut open, &mut units);
            continue;
        }
        if opts.remove_page_numbers && is_page_number(text, false) {
            stats.removed_page_numbers += 1;
            continue;
        }
        if let Some(caption) = image_placeholder(text) {
            close(&mut open, &mut units);
            units.push(Unit::Image {
                id: None,
                caption: Some(caption),
                page: None,
            });
            continue;
        }
        if let Some(rest) = text.strip_prefix('#') {
            let title = rest.trim_start_matches('#').trim();
            if !title.is_empty() && rest.len() > title.len() {
                close(&mut open, &mut units);
                units.push(Unit::Para(Para {
                    text: title.to_string(),
                    page: None,
                    heading: true,
                }));
                continue;
            }
        }
        match open.as_mut() {
            Some((para, true)) => {
                join_line(&mut para.text, text, opts, &vocab);
            }
            _ => {
                close(&mut open, &mut units);
                open = Some((
                    Para {
                        text: text.to_string(),
                        page: None,
                        heading: false,
                    },
                    false,
                ));
            }
        }
        if let Some((_, continues)) = open.as_mut() {
            *continues = wraps(text);
        }
    }

    // 마지막 줄이 꺾인 줄이면 다음 집합으로 넘길 수 있다.
    let open_para = match open {
        Some((p, true)) => Some(p),
        other => {
            let mut tmp = other;
            close(&mut tmp, &mut units);
            None
        }
    };
    TextLayout { units, open: open_para }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(input: &str) -> Vec<String> {
        let lines: Vec<String> = input.lines().map(String::from).collect();
        let r = build_units(&lines, None, &ProcessOptions::default(), &mut Stats::default());
        let mut out: Vec<String> = r
            .units
            .into_iter()
            .map(|u| match u {
                Unit::Para(p) => p.text,
                Unit::Image { caption, .. } => format!("[img {}]", caption.unwrap_or_default()),
            })
            .collect();
        out.extend(r.open.map(|p| p.text));
        out
    }

    #[test]
    fn unwrapped_lines_stay_separate() {
        assert_eq!(
            run("제1장\n탐사자는 저택에 도착한다.\n문이 열려 있다."),
            ["제1장", "탐사자는 저택에 도착한다.", "문이 열려 있다."]
        );
    }

    #[test]
    fn wrapped_lines_are_joined_and_page_numbers_removed() {
        let input = "탐사자는 오래된 저택의 정문 앞에 도착한다 그리고\n안에서 무언가 움직이는 소리를 듣는다 이것은 시작\n12\n에 불과하다.\n\n새 문단.";
        assert_eq!(
            run(input),
            [
                "탐사자는 오래된 저택의 정문 앞에 도착한다 그리고 안에서 무언가 움직이는 소리를 듣는다 이것은 시작에 불과하다.",
                "새 문단."
            ]
        );
    }

    #[test]
    fn placeholders_and_markdown_headings() {
        assert_eq!(run("# 도입\n[이미지: 저택]\n본문."), ["도입", "[img [이미지: 저택]]", "본문."]);
    }
}
