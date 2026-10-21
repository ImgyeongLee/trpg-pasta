//! PDF 페이지의 줄(line) 좌표로 문단을 재구성한다.
//!
//! 프런트엔드(pdf.js)가 글자 조각을 줄 단위로 묶어 좌표와 함께 넘겨주면,
//! 여기서 쪽수/머리글을 걸러내고, 줄 간격·들여쓰기·줄 길이·글자 크기를 보고
//! 문단 경계를 정한다. 이미지는 놓인 위치의 문단이 끝난 직후에 배치한다.
//! 단이 나뉜 쪽(본문 옆 곁단 등)은 단마다 따로, 왼쪽 단부터 읽는다.

use serde::Deserialize;
use std::collections::{HashMap, HashSet};

use super::filters::{furniture_key, is_page_number};
use super::vocab::Vocab;
use super::{ProcessOptions, Stats};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfLine {
    pub text: String,
    /// 왼쪽 위 기준 좌표 (pt)
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub font_size: f32,
    /// 단이 나뉜 쪽에서 몇 번째 단인지 (0부터). 왼쪽 단을 끝까지 읽은 뒤 다음 단을 읽는다.
    #[serde(default)]
    pub column: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfImage {
    pub id: String,
    pub y: f32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfPage {
    pub page_number: u32,
    pub width: f32,
    pub height: f32,
    pub lines: Vec<PdfLine>,
    #[serde(default)]
    pub images: Vec<PdfImage>,
}

#[derive(Debug, Clone)]
pub struct Para {
    pub text: String,
    pub page: Option<u32>,
    pub heading: bool,
}

#[derive(Debug, Clone)]
pub enum Unit {
    Para(Para),
    Image {
        id: Option<String>,
        caption: Option<String>,
        page: Option<u32>,
    },
}

/// 여백(머리글/바닥글) 영역 비율
const MARGIN_RATIO: f32 = 0.1;

fn in_margin(line: &PdfLine, page: &PdfPage) -> bool {
    page.height > 0.0 && (line.y < page.height * MARGIN_RATIO || line.y + line.font_size > page.height * (1.0 - MARGIN_RATIO))
}

/// 같은 자리(여백)에 2쪽 이상 반복된 짧은 줄을 머리글/바닥글로 본다.
/// `seen`은 이전 집합까지의 등장 쪽수로, 집합이 작아도 누적해서 판단할 수 있게 한다.
pub fn detect_furniture(pages: &[PdfPage], known: &mut Vec<String>, seen: &mut HashMap<String, u32>) {
    let mut counts: HashMap<String, HashSet<u32>> = HashMap::new();
    for page in pages {
        for line in &page.lines {
            if in_margin(line, page) && line.text.chars().count() <= 80 {
                let key = furniture_key(&line.text);
                if !key.is_empty() && key != "#" {
                    counts.entry(key).or_default().insert(page.page_number);
                }
            }
        }
    }
    for (key, pages_with_key) in counts {
        let total = seen.entry(key.clone()).or_default();
        *total += pages_with_key.len() as u32;
        if *total >= 2 && !known.contains(&key) {
            known.push(key);
        }
    }
}

fn median(values: &mut [f32]) -> Option<f32> {
    if values.is_empty() {
        return None;
    }
    values.sort_by(|a, b| a.total_cmp(b));
    Some(values[values.len() / 2])
}

fn percentile(values: &mut [f32], p: f32) -> Option<f32> {
    if values.is_empty() {
        return None;
    }
    values.sort_by(|a, b| a.total_cmp(b));
    let idx = ((values.len() - 1) as f32 * p).round() as usize;
    Some(values[idx])
}

pub fn join_line(buf: &mut String, next: &str, opts: &ProcessOptions, vocab: &Vocab) {
    let next = next.trim();
    if next.is_empty() {
        return;
    }
    if buf.is_empty() {
        buf.push_str(next);
        return;
    }
    let last = buf.chars().last().unwrap_or(' ');
    let first = next.chars().next().unwrap_or(' ');
    let before_last = buf.chars().rev().nth(1).unwrap_or(' ');
    if last == '-' && before_last.is_ascii_alphabetic() && first.is_ascii_lowercase() {
        buf.pop();
    } else if is_syllable(last) && is_syllable(first) && (opts.join_lines_without_space || vocab.is_split_word(buf, next)) {
        // 단어 중간에서 줄이 나뉜 경우 (글자 단위 줄나눔)
    } else if !last.is_whitespace() {
        buf.push(' ');
    }
    buf.push_str(next);
}

fn is_syllable(c: char) -> bool {
    ('\u{AC00}'..='\u{D7A3}').contains(&c)
}

struct Open {
    para: Para,
    /// 마지막 줄이 오른쪽 끝까지 찼는지(=다음 줄/다음 쪽으로 이어질 수 있는지)
    continuable: bool,
    deferred: Vec<Unit>,
}

pub struct LayoutResult {
    pub units: Vec<Unit>,
    /// 집합 끝에서 닫히지 않은 문단
    pub open: Option<Para>,
}

pub fn build_units(
    pages: &[PdfPage],
    carried: Option<Para>,
    furniture: &[String],
    opts: &ProcessOptions,
    stats: &mut Stats,
) -> LayoutResult {
    let vocab = Vocab::from_lines(pages.iter().flat_map(|p| p.lines.iter().map(|l| l.text.as_str())));
    let mut units: Vec<Unit> = Vec::new();
    let mut open: Option<Open> = carried.map(|para| Open {
        para,
        continuable: true,
        deferred: Vec::new(),
    });

    let close = |open: &mut Option<Open>, units: &mut Vec<Unit>| {
        if let Some(o) = open.take() {
            if !o.para.text.trim().is_empty() {
                units.push(Unit::Para(o.para));
            }
            units.extend(o.deferred);
        }
    };

    for page in pages {
        // 1) 쪽수, 머리글/바닥글 제거
        let raw_body = median(&mut page.lines.iter().map(|l| l.font_size).collect::<Vec<_>>()).unwrap_or(10.0);
        let mut lines: Vec<&PdfLine> = Vec::new();
        for line in &page.lines {
            let text = line.text.trim();
            if text.is_empty() {
                continue;
            }
            if opts.remove_page_numbers {
                let margin = in_margin(line, page);
                let is_own_number = text.parse::<u32>().ok() == Some(page.page_number);
                if (margin && is_page_number(text, true)) || is_own_number {
                    stats.removed_page_numbers += 1;
                    continue;
                }
            }
            // 위쪽 여백의 본문보다 작은 글씨는 머리글(쪽 제목)로 본다.
            let small_top = line.y < page.height * 0.08 && line.font_size < raw_body * 0.9 && text.chars().count() <= 60;
            if opts.remove_headers && in_margin(line, page) && (small_top || furniture.contains(&furniture_key(text))) {
                stats.removed_headers += 1;
                continue;
            }
            lines.push(line);
        }
        lines.sort_by(|a, b| a.column.cmp(&b.column).then(a.y.total_cmp(&b.y)).then(a.x.total_cmp(&b.x)));

        if lines.is_empty() {
            stats.pages_without_text.push(page.page_number);
        }

        // 본문 글자 크기는 쪽 전체로 (제목 판단 기준)
        let body_size = median(&mut lines.iter().map(|l| l.font_size).collect::<Vec<_>>())
            .unwrap_or(10.0)
            .max(1.0);

        let mut images: Vec<&PdfImage> = page.images.iter().collect();
        images.sort_by(|a, b| a.y.total_cmp(&b.y));
        let mut img_iter = images.into_iter().peekable();

        for (index, column) in lines.chunk_by(|a, b| a.column == b.column).enumerate() {
            // 다음 단은 앞 단의 문단과 이어지지 않는다.
            if index > 0 {
                close(&mut open, &mut units);
            }

            // 2) 단 통계: 좌우 여백, 줄 간격
            let body: Vec<&&PdfLine> = column
                .iter()
                .filter(|l| (l.font_size - body_size).abs() <= body_size * 0.15)
                .collect();
            let left = percentile(&mut body.iter().map(|l| l.x).collect::<Vec<_>>(), 0.1).unwrap_or(0.0);
            // 줄이 적은 단은 오른쪽 끝을 추정하기 어려우니 좌우 여백이 같다고 본다 (곁단은 쪽 오른쪽 끝까지).
            let right = if body.len() >= 5 {
                percentile(&mut body.iter().map(|l| l.x + l.width).collect::<Vec<_>>(), 0.9).unwrap_or(page.width)
            } else if index == 0 {
                page.width - left
            } else {
                page.width
            };
            let mut pitches: Vec<f32> = column
                .windows(2)
                .filter(|w| (w[0].font_size - body_size).abs() <= body_size * 0.15 && (w[1].font_size - body_size).abs() <= body_size * 0.15)
                .map(|w| w[1].y - w[0].y)
                .filter(|d| *d > 0.0)
                .collect();
            let pitch = median(&mut pitches).unwrap_or(body_size * 1.5).max(body_size);
            let full_slack = (body_size * 2.5).max(page.width * 0.06);

            // 3) 줄과 이미지를 위에서 아래로
            let mut prev: Option<&PdfLine> = None;

            for line in column {
                while let Some(img) = img_iter.next_if(|img| img.y <= line.y) {
                    let unit = Unit::Image {
                        id: Some(img.id.clone()),
                        caption: None,
                        page: Some(page.page_number),
                    };
                    match open.as_mut() {
                        Some(o) => o.deferred.push(unit),
                        None => units.push(unit),
                    }
                }

                let heading = line.font_size > body_size * 1.2 && line.text.chars().count() < 80;
                let full = line.x + line.width >= right - full_slack;
                let starts_new = match (&open, prev) {
                    (None, _) => true,
                    // 이전 쪽(또는 이전 집합)에서 이어지는 문단
                    (Some(o), None) => !o.continuable || heading || o.para.heading,
                    (Some(o), Some(p)) => {
                        let gap = line.y - p.y;
                        if heading != o.para.heading {
                            true
                        } else if heading {
                            gap > line.font_size * 1.8
                        } else {
                            let indented = line.x > left + body_size * 0.8 && line.x - p.x > body_size * 0.8;
                            gap > pitch * 1.5 || !o.continuable || indented
                        }
                    }
                };
                if starts_new {
                    close(&mut open, &mut units);
                    open = Some(Open {
                        para: Para {
                            text: String::new(),
                            page: Some(page.page_number),
                            heading,
                        },
                        continuable: false,
                        deferred: Vec::new(),
                    });
                }
                let o = open.as_mut().expect("open paragraph exists");
                join_line(&mut o.para.text, &line.text, opts, &vocab);
                o.continuable = full && !heading;
                prev = Some(line);
            }
        }

        for img in img_iter {
            let unit = Unit::Image {
                id: Some(img.id.clone()),
                caption: None,
                page: Some(page.page_number),
            };
            match open.as_mut() {
                Some(o) => o.deferred.push(unit),
                None => units.push(unit),
            }
        }

        // 쪽 끝: 마지막 줄이 꽉 차지 않았다면 문단이 끝난 것.
        // 단이 나뉜 쪽은 마지막이 곁단이므로 다음 쪽 본문과 잇지 않는다.
        let columns = lines.first().zip(lines.last()).is_some_and(|(a, b)| a.column != b.column);
        if columns || open.as_ref().is_some_and(|o| !o.continuable) {
            close(&mut open, &mut units);
        }
    }

    // 집합 끝에서 열려 있는 문단은 호출자가 다음 집합으로 넘길지 결정한다.
    let open_para = open.map(|o| {
        units.extend(o.deferred);
        o.para
    });
    LayoutResult { units, open: open_para }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(text: &str, y: f32, width: f32) -> PdfLine {
        PdfLine {
            text: text.into(),
            x: 50.0,
            y,
            width,
            font_size: 10.0,
            column: 0,
        }
    }

    fn page(n: u32, lines: Vec<PdfLine>) -> PdfPage {
        PdfPage {
            page_number: n,
            width: 600.0,
            height: 800.0,
            lines,
            images: vec![],
        }
    }

    fn texts(units: &[Unit]) -> Vec<String> {
        units
            .iter()
            .map(|u| match u {
                Unit::Para(p) => p.text.clone(),
                Unit::Image { id, .. } => format!("[img {}]", id.clone().unwrap_or_default()),
            })
            .collect()
    }

    #[test]
    fn joins_wrapped_lines_and_breaks_on_short_line() {
        let p = page(
            1,
            vec![
                line("문단 첫 줄은 오른쪽", 100.0, 500.0),
                line("끝까지 차 있다.", 114.0, 120.0),
                line("새 문단이다.", 128.0, 100.0),
            ],
        );
        let r = build_units(&[p], None, &[], &ProcessOptions::default(), &mut Stats::default());
        let mut all = texts(&r.units);
        all.extend(r.open.map(|p| p.text));
        assert_eq!(all, ["문단 첫 줄은 오른쪽 끝까지 차 있다.", "새 문단이다."]);
    }

    #[test]
    fn removes_page_numbers_in_margin() {
        let p = page(
            3,
            vec![
                line("본문.", 100.0, 100.0),
                PdfLine {
                    text: "- 3 -".into(),
                    x: 290.0,
                    y: 770.0,
                    width: 20.0,
                    font_size: 9.0,
                    column: 0,
                },
            ],
        );
        let mut stats = Stats::default();
        let r = build_units(&[p], None, &[], &ProcessOptions::default(), &mut stats);
        assert_eq!(texts(&r.units), ["본문."]);
        assert_eq!(stats.removed_page_numbers, 1);
    }

    #[test]
    fn continues_across_pages() {
        let p1 = page(1, vec![line("다음 쪽으로 이어지는", 700.0, 500.0)]);
        let p2 = page(2, vec![line("문장이다.", 60.0, 100.0)]);
        let r = build_units(&[p1, p2], None, &[], &ProcessOptions::default(), &mut Stats::default());
        assert_eq!(texts(&r.units), ["다음 쪽으로 이어지는 문장이다."]);
    }

    #[test]
    fn images_follow_open_paragraph() {
        let mut p = page(
            1,
            vec![line("이미지 옆으로 이어지는", 100.0, 500.0), line("문단.", 300.0 - 186.0, 50.0)],
        );
        p.images.push(PdfImage { id: "a".into(), y: 105.0 });
        let r = build_units(&[p], None, &[], &ProcessOptions::default(), &mut Stats::default());
        assert_eq!(texts(&r.units), ["이미지 옆으로 이어지는 문단.", "[img a]"]);
    }

    #[test]
    fn reads_left_column_before_side_column() {
        // 본문(왼쪽 단) 옆에 곁단(KP 정보)이 있는 쪽: 같은 높이의 줄이 섞이지 않고, 단마다 줄을 이어 문단을 만든다.
        let main = |text: &str, y: f32, width: f32| PdfLine { width, ..line(text, y, 0.0) };
        let side = |text: &str, y: f32, width: f32| PdfLine {
            x: 420.0,
            column: 1,
            ..main(text, y, width)
        };
        let p = page(
            1,
            vec![
                main("문을 열자 차가운 바람이", 100.0, 340.0),
                side("※KP정보", 100.0, 40.0),
                main("방 안으로 불어 들어왔습니다.", 114.0, 150.0),
                side("이 바람은 누군가가", 114.0, 130.0),
                side("일부러 창문을 열어 둔", 128.0, 130.0),
                main("책상 위에는 낡은 일기장이 놓여 있고,", 142.0, 340.0),
                side("흔적입니다.", 142.0, 50.0),
                main("펼쳐진 쪽에는 날짜가 적혀 있습니다.", 156.0, 200.0),
                side("일기장은 탐사자가 읽을", 184.0, 130.0),
                main("탐사자는 숨을 고릅니다.", 184.0, 340.0),
                side("때까지 아무 일도", 198.0, 130.0),
                side("일어나지 않습니다.", 212.0, 90.0),
            ],
        );
        let r = build_units(&[p], None, &[], &ProcessOptions::default(), &mut Stats::default());
        assert_eq!(
            texts(&r.units),
            [
                "문을 열자 차가운 바람이 방 안으로 불어 들어왔습니다.",
                "책상 위에는 낡은 일기장이 놓여 있고, 펼쳐진 쪽에는 날짜가 적혀 있습니다.",
                "탐사자는 숨을 고릅니다.",
                "※KP정보",
                "이 바람은 누군가가 일부러 창문을 열어 둔 흔적입니다.",
                "일기장은 탐사자가 읽을 때까지 아무 일도 일어나지 않습니다.",
            ]
        );
    }

    #[test]
    fn side_column_does_not_continue_to_next_page() {
        let side = PdfLine {
            x: 420.0,
            column: 1,
            ..line("곁단 마지막 줄이 꽉 찬", 700.0, 130.0)
        };
        let p1 = page(1, vec![line("본문.", 100.0, 60.0), side]);
        let p2 = page(2, vec![line("다음 쪽 본문.", 60.0, 100.0)]);
        let r = build_units(&[p1, p2], None, &[], &ProcessOptions::default(), &mut Stats::default());
        assert_eq!(texts(&r.units), ["본문.", "곁단 마지막 줄이 꽉 찬", "다음 쪽 본문."]);
    }

    #[test]
    fn detects_running_headers() {
        let pages: Vec<PdfPage> = (1..=3)
            .map(|n| {
                page(
                    n,
                    vec![
                        PdfLine {
                            text: format!("시나리오 제목 {n}"),
                            x: 50.0,
                            y: 20.0,
                            width: 100.0,
                            font_size: 9.0,
                            column: 0,
                        },
                        line("본문.", 100.0, 60.0),
                    ],
                )
            })
            .collect();
        let mut known = Vec::new();
        detect_furniture(&pages, &mut known, &mut HashMap::new());
        assert_eq!(known.len(), 1);
        let mut stats = Stats::default();
        let r = build_units(&pages, None, &known, &ProcessOptions::default(), &mut stats);
        assert_eq!(texts(&r.units), ["본문.", "본문.", "본문."]);
        assert_eq!(stats.removed_headers, 3);
    }
}
