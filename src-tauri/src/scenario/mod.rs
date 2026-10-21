//! TASK 1 시나리오 준비: PDF/텍스트 시나리오를 문장 단위 블록으로 정리한다.
//!
//! 긴 시나리오는 프런트엔드가 페이지(또는 줄) 묶음, 즉 "집합" 단위로 잘라 차례로 보낸다.
//! 집합 경계에서 잘린 문장은 `Carry`에 담아 다음 집합 앞에 이어 붙인다.

pub mod filters;
pub mod layout;
pub mod plain;
pub mod segment;
pub mod vocab;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use layout::{Para, PdfPage, Unit};
use segment::{RawSentence, SplitOptions, Warning, contains_ellipsis, dialogue_closer, is_terminator};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ProcessOptions {
    pub split_on_ellipsis: bool,
    /// 한글 음절 사이 줄바꿈을 항상 공백 없이 잇는다. 끄면 문서 어휘를 보고 자동 판단한다.
    pub join_lines_without_space: bool,
    pub remove_page_numbers: bool,
    pub remove_headers: bool,
}

impl Default for ProcessOptions {
    fn default() -> Self {
        Self {
            split_on_ellipsis: false,
            join_lines_without_space: false,
            remove_page_numbers: true,
            remove_headers: true,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Carry {
    /// 이전 집합 끝에서 완결되지 않은 문장
    pub pending: Option<String>,
    pub pending_page: Option<u32>,
    /// 지금까지 찾은 머리글/바닥글 (정규화된 키)
    pub furniture: Vec<String>,
    /// 여백 줄(정규화 키)이 지금까지 등장한 쪽 수
    pub margin_seen: HashMap<String, u32>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub removed_page_numbers: u32,
    pub removed_headers: u32,
    pub pages_without_text: Vec<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SentenceKind {
    Narration,
    Dialogue,
    Heading,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Block {
    #[serde(rename_all = "camelCase")]
    Sentence {
        text: String,
        kind: SentenceKind,
        has_ellipsis: bool,
        warnings: Vec<Warning>,
        page: Option<u32>,
    },
    #[serde(rename_all = "camelCase")]
    Image {
        image_id: Option<String>,
        caption: Option<String>,
        page: Option<u32>,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkOutput {
    pub blocks: Vec<Block>,
    pub carry: Carry,
    pub stats: Stats,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfChunkInput {
    pub pages: Vec<PdfPage>,
    #[serde(default)]
    pub carry: Carry,
    pub is_last: bool,
    #[serde(default)]
    pub options: ProcessOptions,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextChunkInput {
    pub lines: Vec<String>,
    #[serde(default)]
    pub carry: Carry,
    pub is_last: bool,
    #[serde(default)]
    pub options: ProcessOptions,
}

const TOO_LONG: usize = 300;

fn classify(raw: RawSentence, heading: bool, page: Option<u32>) -> Block {
    let first = raw.text.chars().next();
    let last = raw.text.trim_end_matches(|c: char| is_terminator(c)).chars().last();
    let kind = if heading {
        SentenceKind::Heading
    } else if first.and_then(dialogue_closer).is_some_and(|close| last == Some(close)) {
        SentenceKind::Dialogue
    } else {
        SentenceKind::Narration
    };
    let mut warnings = raw.warnings;
    // 말줄임표로 끝난 문장은 이미 '말줄임'으로 분류되므로 문장 부호 경고를 달지 않는다.
    let ends_with_ellipsis = {
        let t = raw
            .text
            .trim_end_matches(|c: char| c.is_whitespace() || matches!(c, '"' | '\'' | '”' | '’' | '」' | '』' | ')'));
        t.ends_with("..") || t.ends_with(['…', '‥', '⋯'])
    };
    if !raw.terminated && kind == SentenceKind::Narration && !ends_with_ellipsis {
        warnings.push(Warning::NoTerminator);
    }
    if raw.text.chars().count() > TOO_LONG {
        warnings.push(Warning::TooLong);
    }
    Block::Sentence {
        has_ellipsis: contains_ellipsis(&raw.text),
        text: raw.text,
        kind,
        warnings,
        page,
    }
}

fn para_blocks(sentences: Vec<RawSentence>, para: &Para) -> Vec<Block> {
    // 문장 부호 없이 짧게 홀로 선 문단은 제목/항목으로 본다.
    let short_label = sentences.len() == 1
        && !sentences[0].terminated
        && sentences[0].text.chars().count() <= 40
        && sentences[0].text.chars().next().is_none_or(|c| dialogue_closer(c).is_none());
    let heading = para.heading || short_label;
    sentences.into_iter().map(|s| classify(s, heading, para.page)).collect()
}

fn finish(units: Vec<Unit>, open: Option<Para>, is_last: bool, opts: &ProcessOptions, base: Carry, stats: Stats) -> ChunkOutput {
    let split_opts = SplitOptions {
        split_on_ellipsis: opts.split_on_ellipsis,
    };
    let mut blocks = Vec::new();
    for unit in units {
        match unit {
            Unit::Para(p) => blocks.extend(para_blocks(segment::split(&p.text, split_opts), &p)),
            Unit::Image { id, caption, page } => blocks.push(Block::Image {
                image_id: id,
                caption,
                page,
            }),
        }
    }
    let mut carry = Carry {
        pending: None,
        pending_page: None,
        ..base
    };
    if let Some(p) = open {
        if is_last {
            blocks.extend(para_blocks(segment::split(&p.text, split_opts), &p));
        } else {
            let (done, tail) = segment::split_with_tail(&p.text, split_opts);
            blocks.extend(done.into_iter().map(|s| classify(s, p.heading, p.page)));
            carry.pending = tail;
            carry.pending_page = p.page;
        }
    }
    ChunkOutput { blocks, carry, stats }
}

fn carried_para(carry: &Carry) -> Option<Para> {
    carry.pending.as_ref().map(|t| Para {
        text: t.clone(),
        page: carry.pending_page,
        heading: false,
    })
}

pub fn process_pdf_chunk(input: PdfChunkInput) -> ChunkOutput {
    let mut stats = Stats::default();
    let carried = carried_para(&input.carry);
    let mut base = input.carry;
    if input.options.remove_headers {
        layout::detect_furniture(&input.pages, &mut base.furniture, &mut base.margin_seen);
    }
    let r = layout::build_units(&input.pages, carried, &base.furniture, &input.options, &mut stats);
    finish(r.units, r.open, input.is_last, &input.options, base, stats)
}

pub fn process_text_chunk(input: TextChunkInput) -> ChunkOutput {
    let mut stats = Stats::default();
    let r = plain::build_units(&input.lines, carried_para(&input.carry), &input.options, &mut stats);
    finish(r.units, r.open, input.is_last, &input.options, input.carry, stats)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sentences(out: &ChunkOutput) -> Vec<(String, SentenceKind, bool)> {
        out.blocks
            .iter()
            .filter_map(|b| match b {
                Block::Sentence {
                    text, kind, has_ellipsis, ..
                } => Some((text.clone(), *kind, *has_ellipsis)),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn text_chunk_end_to_end() {
        let lines: Vec<String> = "도입\n\"누구세요?\" 탐사자가 묻는다. 대답이 없다...\n3\n문이 열린다."
            .lines()
            .map(String::from)
            .collect();
        let out = process_text_chunk(TextChunkInput {
            lines,
            carry: Carry::default(),
            is_last: true,
            options: ProcessOptions::default(),
        });
        assert_eq!(
            sentences(&out),
            [
                ("도입".into(), SentenceKind::Heading, false),
                ("\"누구세요?\"".into(), SentenceKind::Dialogue, false),
                ("탐사자가 묻는다.".into(), SentenceKind::Narration, false),
                ("대답이 없다...".into(), SentenceKind::Narration, true),
                ("문이 열린다.".into(), SentenceKind::Narration, false),
            ]
        );
        assert_eq!(out.stats.removed_page_numbers, 1);
    }

    #[test]
    fn ellipsis_ending_has_no_terminator_warning() {
        let lines = vec![
            "문을 열었다. 대답이 없다...".to_string(),
            String::new(),
            "끝나지 않은 문장이고 꽤 길어서 제목이나 항목으로는 보이지 않는 문단이다 그런데 마침표가 없이".to_string(),
        ];
        let out = process_text_chunk(TextChunkInput {
            lines,
            carry: Carry::default(),
            is_last: true,
            options: ProcessOptions::default(),
        });
        let warnings: Vec<Vec<Warning>> = out
            .blocks
            .iter()
            .filter_map(|b| match b {
                Block::Sentence { warnings, .. } => Some(warnings.clone()),
                _ => None,
            })
            .collect();
        assert_eq!(warnings, [vec![], vec![], vec![Warning::NoTerminator]]);
    }

    #[test]
    fn carry_joins_sentence_across_chunks() {
        let opts = ProcessOptions::default();
        let page = |n: u32, text: &str, width: f32| PdfPage {
            page_number: n,
            width: 600.0,
            height: 800.0,
            lines: vec![layout::PdfLine {
                text: text.into(),
                x: 50.0,
                y: 400.0,
                width,
                font_size: 10.0,
                column: 0,
            }],
            images: vec![],
        };
        let first = process_pdf_chunk(PdfChunkInput {
            pages: vec![page(1, "완결된 문장. 집합 경계에서 끊긴", 500.0)],
            carry: Carry::default(),
            is_last: false,
            options: opts.clone(),
        });
        assert_eq!(sentences(&first).len(), 1);
        assert_eq!(first.carry.pending.as_deref(), Some("집합 경계에서 끊긴"));
        let second = process_pdf_chunk(PdfChunkInput {
            pages: vec![page(2, "문장이다.", 80.0)],
            carry: first.carry,
            is_last: true,
            options: opts,
        });
        assert_eq!(sentences(&second)[0].0, "집합 경계에서 끊긴 문장이다.");
    }
}
