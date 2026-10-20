//! 문단 텍스트를 문장 단위로 나눈다.
//!
//! 규칙 요약
//! - `.` `?` `!` (및 전각 문자) 뒤에서 나눈다. 단, 소수점·목록 번호·약어·URL은 예외.
//! - 말줄임표(`...`, `......`, `…`, `. . .`)는 문장 끝으로 보지 않는다(옵션으로 변경 가능).
//! - 따옴표/괄호 안에서는 나누지 않는다. 문장 맨 앞에서 시작한 대사가 닫히고 뒤에
//!   공백이 오면 대사를 별도 문장으로 떼어낸다(`"안녕." 그가 말했다.`).
//!   단 `"안녕" 하고 말했다`처럼 인용 동사가 이어지면 떼지 않는다.
//! - 짝이 맞지 않는 따옴표는 무시하고 다시 나눈 뒤 해당 문장에 경고를 단다.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Warning {
    /// 짝이 맞지 않는 따옴표나 괄호가 있다.
    UnbalancedQuote,
    /// 문장 부호 없이 끝났다 (줄바꿈 오인식, 표, 목록일 수 있음).
    NoTerminator,
    /// 지나치게 길다 (문장 분리가 덜 됐을 수 있음).
    TooLong,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct SplitOptions {
    /// 말줄임표 뒤에 공백이 오면 문장을 나눈다.
    pub split_on_ellipsis: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RawSentence {
    pub text: String,
    /// 문장 부호(또는 닫힌 대사)로 끝났는지.
    pub terminated: bool,
    pub warnings: Vec<Warning>,
}

const QUOTE_VERBS: &[&str] = &[
    "하고",
    "하며",
    "하면서",
    "하는",
    "하자",
    "하던",
    "하니",
    "하여",
    "해서",
    "하였",
    "했",
    "한다",
    "합니다",
    "하길",
    "하곤",
    "라고",
    "라며",
    "라는",
    "이라고",
    "이라며",
    "이라는",
];

const ABBREVIATIONS: &[&str] = &[
    "mr", "mrs", "ms", "dr", "st", "vs", "etc", "no", "vol", "p", "pp", "cf", "jr", "sr", "prof", "fig", "e.g", "i.e",
];

pub fn is_terminator(c: char) -> bool {
    matches!(c, '.' | '?' | '!' | '。' | '？' | '！' | '．')
}

pub fn is_ellipsis_char(c: char) -> bool {
    matches!(c, '…' | '‥' | '⋯' | '︙')
}

fn is_hangul(c: char) -> bool {
    matches!(c, '\u{AC00}'..='\u{D7A3}' | '\u{1100}'..='\u{11FF}' | '\u{3130}'..='\u{318F}')
}

/// 여는 문자에 대응하는 닫는 문자.
fn closer_for(c: char) -> Option<char> {
    Some(match c {
        '"' => '"',
        '\'' => '\'',
        '“' => '”',
        '‘' => '’',
        '「' => '」',
        '『' => '』',
        '«' => '»',
        '(' => ')',
        '（' => '）',
        '[' => ']',
        '【' => '】',
        '〈' => '〉',
        '《' => '》',
        _ => return None,
    })
}

/// 대사(또는 속마음)로 취급하는 따옴표.
pub fn is_dialogue_opener(c: char) -> bool {
    matches!(c, '"' | '“' | '\'' | '‘' | '「' | '『' | '«')
}

pub fn dialogue_closer(c: char) -> Option<char> {
    if is_dialogue_opener(c) { closer_for(c) } else { None }
}

fn is_closing_char(c: char) -> bool {
    matches!(
        c,
        '"' | '\'' | '”' | '’' | '」' | '』' | '»' | ')' | '）' | ']' | '】' | '〉' | '》'
    )
}

/// `i`에서 시작하는 말줄임표의 길이(문자 수).
fn ellipsis_len(chars: &[char], i: usize) -> Option<usize> {
    let n = chars.len();
    let c = chars[i];
    if is_ellipsis_char(c) {
        let mut j = i;
        while j < n && (is_ellipsis_char(chars[j]) || chars[j] == '.') {
            j += 1;
        }
        return Some(j - i);
    }
    if c == '.' || c == '。' {
        let mut j = i;
        while j < n && chars[j] == c {
            j += 1;
        }
        if j - i >= 2 {
            return Some(j - i);
        }
        // ". . ." 처럼 띄어 쓴 말줄임표
        if c == '.' {
            let mut k = i;
            let mut dots = 0;
            while k < n && chars[k] == '.' {
                dots += 1;
                k += 1;
                if k + 1 < n && chars[k] == ' ' && chars[k + 1] == '.' {
                    k += 1;
                } else {
                    break;
                }
            }
            if dots >= 3 {
                return Some(k - i);
            }
        }
    }
    None
}

pub fn contains_ellipsis(text: &str) -> bool {
    let chars: Vec<char> = text.chars().collect();
    (0..chars.len()).any(|i| ellipsis_len(&chars, i).is_some())
}

struct Opener {
    close: char,
    pos: usize,
}

struct Scan {
    /// (start, end, terminated). end는 exclusive.
    segments: Vec<(usize, usize, bool)>,
    /// 끝까지 닫히지 않은 여는 문자 위치.
    unclosed: Vec<usize>,
    /// 짝이 엇갈린 여는 문자 위치.
    mismatched: Vec<usize>,
}

fn skip_ws(chars: &[char], mut i: usize) -> usize {
    while i < chars.len() && chars[i].is_whitespace() {
        i += 1;
    }
    i
}

fn boundary_ok(chars: &[char], end: usize) -> bool {
    match chars.get(end) {
        None => true,
        Some(&c) => c.is_whitespace() || is_hangul(c) || closer_for(c).is_some(),
    }
}

fn quote_verb_follows(chars: &[char], j: usize) -> bool {
    let k = skip_ws(chars, j);
    let rest: String = chars[k..chars.len().min(k + 4)].iter().collect();
    QUOTE_VERBS.iter().any(|v| rest.starts_with(v))
}

/// 대사 안쪽 끝이 문장 끝처럼 보이는지 (닫는 따옴표 직전 문자).
fn quote_content_terminal(chars: &[char], open_pos: usize, close_pos: usize) -> bool {
    let mut k = close_pos;
    while k > open_pos + 1 {
        k -= 1;
        let c = chars[k];
        if c.is_whitespace() {
            continue;
        }
        return is_terminator(c)
            || is_ellipsis_char(c)
            || is_closing_char(c)
            || matches!(c, '~' | '～' | '-' | '—' | '–' | '♪' | '♡' | '♥');
    }
    false
}

/// 이 마침표가 문장 끝이 아닌 경우(소수점, 목록 번호, 약어, URL).
fn keep_period(chars: &[char], start: usize, i: usize) -> bool {
    let prev = if i > 0 { Some(chars[i - 1]) } else { None };
    let next = chars.get(i + 1).copied();
    if let (Some(p), Some(nx)) = (prev, next)
        && p.is_ascii_digit()
        && nx.is_ascii_digit()
    {
        return true;
    }
    if next.is_some_and(|c| c.is_ascii_alphanumeric()) {
        return true;
    }
    let before: String = chars[start..i].iter().collect();
    let before = before.trim();
    let next_is_space = next.is_some_and(char::is_whitespace);
    // "1. 도입", "A. 개요", "iv. 결말", "가. 항목"
    if next_is_space {
        let is_marker = (!before.is_empty() && before.len() <= 3 && before.chars().all(|c| c.is_ascii_digit()))
            || (before.chars().count() == 1 && before.chars().all(|c| c.is_ascii_alphabetic()))
            || (!before.is_empty() && before.len() <= 4 && before.chars().all(|c| matches!(c, 'i' | 'v' | 'x' | 'I' | 'V' | 'X')))
            || matches!(
                before,
                "가" | "나" | "다" | "라" | "마" | "바" | "사" | "아" | "자" | "차" | "카" | "타" | "파" | "하"
            );
        if is_marker {
            return true;
        }
    }
    // 약어 (Mr. Dr. etc.)
    let word: String = chars[start..i]
        .iter()
        .rev()
        .take_while(|c| c.is_ascii_alphabetic() || **c == '.')
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    let word = word.to_ascii_lowercase();
    !word.is_empty() && ABBREVIATIONS.contains(&word.as_str())
}

fn scan(chars: &[char], ignored: &[usize], opts: SplitOptions) -> Scan {
    let n = chars.len();
    let mut out = Scan {
        segments: Vec::new(),
        unclosed: Vec::new(),
        mismatched: Vec::new(),
    };
    let mut stack: Vec<Opener> = Vec::new();
    let mut start = skip_ws(chars, 0);
    let mut i = start;

    while i < n {
        let c = chars[i];
        if ignored.contains(&i) {
            i += 1;
            continue;
        }

        // 1) 닫는 문자
        if let Some(idx) = stack.iter().rposition(|o| o.close == c) {
            for o in stack.drain(idx + 1..) {
                out.mismatched.push(o.pos);
            }
            let o = stack.pop().expect("index came from rposition");
            // 문장 맨 앞에서 열린 대사/괄호가 완결된 문장으로 닫히면 따로 뗀다.
            if stack.is_empty() && o.pos == start && quote_content_terminal(chars, o.pos, i) {
                let j = i + 1;
                if j >= n {
                    out.segments.push((start, n, true));
                    start = n;
                    break;
                }
                if chars[j].is_whitespace() && !quote_verb_follows(chars, j) {
                    out.segments.push((start, j, true));
                    start = skip_ws(chars, j);
                    i = start;
                    continue;
                }
            }
            i += 1;
            continue;
        }

        // 2) 여는 문자
        if let Some(close) = closer_for(c) {
            let opens = match c {
                // 아포스트로피(don't)는 여는 따옴표로 보지 않는다.
                '\'' => i == 0 || !chars[i - 1].is_alphanumeric(),
                _ => true,
            };
            if opens {
                stack.push(Opener { close, pos: i });
                i += 1;
                continue;
            }
        }

        if !stack.is_empty() {
            i += 1;
            continue;
        }

        // 3) 말줄임표
        if let Some(len) = ellipsis_len(chars, i) {
            let mut end = i + len;
            if opts.split_on_ellipsis {
                while end < n && (is_terminator(chars[end]) || is_ellipsis_char(chars[end])) {
                    end += 1;
                }
                if end >= n || chars[end].is_whitespace() {
                    out.segments.push((start, end, true));
                    start = skip_ws(chars, end);
                    i = start;
                    continue;
                }
            }
            i = end;
            continue;
        }

        // 4) 문장 부호
        if is_terminator(c) {
            if (c == '.' || c == '．') && keep_period(chars, start, i) {
                i += 1;
                continue;
            }
            let mut end = i + 1;
            while end < n && (is_terminator(chars[end]) || is_ellipsis_char(chars[end])) {
                end += 1;
            }
            // 짝 없는 닫는 문자(앞 문단에서 열린 따옴표 등)는 문장에 붙인다.
            while end < n && is_closing_char(chars[end]) {
                end += 1;
            }
            if boundary_ok(chars, end) {
                out.segments.push((start, end, true));
                start = skip_ws(chars, end);
                i = start;
                continue;
            }
            i = end;
            continue;
        }

        i += 1;
    }

    if start < n && chars[start..].iter().any(|c| !c.is_whitespace()) {
        out.segments.push((start, n, false));
    }
    out.unclosed = stack.into_iter().map(|o| o.pos).collect();
    out
}

fn to_sentences(chars: &[char], scan: &Scan, flagged: &[usize]) -> Vec<RawSentence> {
    scan.segments
        .iter()
        .filter_map(|&(s, e, terminated)| {
            let text: String = chars[s..e].iter().collect::<String>().trim().to_string();
            if text.is_empty() {
                return None;
            }
            let mut warnings = Vec::new();
            if flagged.iter().any(|&p| p >= s && p < e) {
                warnings.push(Warning::UnbalancedQuote);
            }
            Some(RawSentence {
                text,
                terminated,
                warnings,
            })
        })
        .collect()
}

/// 문단 하나를 문장들로 나눈다. 짝이 맞지 않는 따옴표는 무시하고 경고를 단다.
pub fn split(text: &str, opts: SplitOptions) -> Vec<RawSentence> {
    let chars: Vec<char> = text.chars().collect();
    let mut ignored: Vec<usize> = Vec::new();
    let mut flagged: Vec<usize> = Vec::new();
    let mut result = scan(&chars, &ignored, opts);
    for _ in 0..16 {
        flagged.extend(result.mismatched.iter().copied());
        if result.unclosed.is_empty() {
            break;
        }
        // 가장 바깥(먼저 열린) 문자부터 무시하고 다시 시도한다.
        let first = result.unclosed[0];
        ignored.push(first);
        flagged.push(first);
        result = scan(&chars, &ignored, opts);
    }
    flagged.sort_unstable();
    flagged.dedup();
    to_sentences(&chars, &result, &flagged)
}

/// 다음 집합(chunk)으로 이어질 수 있는 문단을 나눈다.
/// 완결된 문장들과, 다음 집합 텍스트 앞에 붙일 미완성 꼬리를 돌려준다.
pub fn split_with_tail(text: &str, opts: SplitOptions) -> (Vec<RawSentence>, Option<String>) {
    let chars: Vec<char> = text.chars().collect();
    let result = scan(&chars, &[], opts);
    let open_tail = !result.unclosed.is_empty() || result.segments.last().is_some_and(|s| !s.2);
    if !open_tail {
        return (to_sentences(&chars, &result, &result.mismatched), None);
    }
    let Some(&(tail_start, _, _)) = result.segments.last() else {
        return (Vec::new(), None);
    };
    // 꼬리가 너무 길면 이어 붙이지 않고 그대로 확정한다.
    if chars.len() - tail_start > 4000 {
        return (split(text, opts), None);
    }
    let head: String = chars[..tail_start].iter().collect();
    let tail: String = chars[tail_start..].iter().collect::<String>().trim().to_string();
    let sentences = if head.trim().is_empty() { Vec::new() } else { split(&head, opts) };
    (sentences, Some(tail).filter(|t| !t.is_empty()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn texts(input: &str) -> Vec<String> {
        split(input, SplitOptions::default()).into_iter().map(|s| s.text).collect()
    }

    #[test]
    fn splits_on_periods() {
        assert_eq!(
            texts("문이 열린다. 안은 어둡다. 무엇이 있을까?"),
            ["문이 열린다.", "안은 어둡다.", "무엇이 있을까?"]
        );
    }

    #[test]
    fn splits_without_space_before_hangul() {
        assert_eq!(texts("문이 열린다.안은 어둡다."), ["문이 열린다.", "안은 어둡다."]);
    }

    #[test]
    fn keeps_ellipsis_inside_sentence() {
        assert_eq!(texts("문이 열린다... 안은 어둡다."), ["문이 열린다... 안은 어둡다."]);
        assert_eq!(texts("그런데...... 아무도 없었다. 끝."), ["그런데...... 아무도 없었다.", "끝."]);
        assert_eq!(texts("그런데… 아무도. 없었다."), ["그런데… 아무도.", "없었다."]);
        assert_eq!(texts("그런데. . . 아무도 없었다."), ["그런데. . . 아무도 없었다."]);
    }

    #[test]
    fn splits_on_ellipsis_when_enabled() {
        let out: Vec<String> = split("문이 열린다... 안은 어둡다.", SplitOptions { split_on_ellipsis: true })
            .into_iter()
            .map(|s| s.text)
            .collect();
        assert_eq!(out, ["문이 열린다...", "안은 어둡다."]);
    }

    #[test]
    fn ellipsis_detection() {
        assert!(contains_ellipsis("그런데..."));
        assert!(contains_ellipsis("그런데……"));
        assert!(contains_ellipsis("그런데. . ."));
        assert!(!contains_ellipsis("그런데. 아니."));
    }

    #[test]
    fn dialogue_is_separated() {
        assert_eq!(
            texts("\"안녕. 오랜만이야.\" 그가 말했다. 그리고 웃었다."),
            ["\"안녕. 오랜만이야.\"", "그가 말했다.", "그리고 웃었다."]
        );
        assert_eq!(
            texts("“가자!” “어디로?” 그녀가 물었다."),
            ["“가자!”", "“어디로?”", "그녀가 물었다."]
        );
    }

    #[test]
    fn dialogue_with_quote_verb_stays() {
        assert_eq!(texts("\"안녕.\" 하고 그가 말했다."), ["\"안녕.\" 하고 그가 말했다."]);
        assert_eq!(texts("\"안녕.\"이라고 그가 말했다. 끝."), ["\"안녕.\"이라고 그가 말했다.", "끝."]);
        assert_eq!(texts("그는 \"여기다. 빨리.\"라고 외쳤다."), ["그는 \"여기다. 빨리.\"라고 외쳤다."]);
    }

    #[test]
    fn parentheses_are_not_split() {
        assert_eq!(
            texts("(주의. 이 장면은 비공개.) 다음으로 넘어간다."),
            ["(주의. 이 장면은 비공개.)", "다음으로 넘어간다."]
        );
    }

    #[test]
    fn decimals_lists_and_urls() {
        assert_eq!(texts("확률은 3.5%다. 다음."), ["확률은 3.5%다.", "다음."]);
        assert_eq!(texts("1. 도입부를 읽는다."), ["1. 도입부를 읽는다."]);
        assert_eq!(texts("www.example.com 참고. 끝."), ["www.example.com 참고.", "끝."]);
        assert_eq!(texts("SAN 0/1d3. 다음."), ["SAN 0/1d3.", "다음."]);
    }

    #[test]
    fn unbalanced_quote_falls_back_with_warning() {
        let out = split("“안녕. 그가 말했다. 끝.", SplitOptions::default());
        assert_eq!(out.len(), 3);
        assert_eq!(out[0].warnings, vec![Warning::UnbalancedQuote]);
        assert!(out[1].warnings.is_empty());
    }

    #[test]
    fn apostrophe_is_not_a_quote() {
        assert_eq!(texts("I don't know. 끝."), ["I don't know.", "끝."]);
    }

    #[test]
    fn unterminated_tail() {
        let out = split("문장 하나. 끝나지 않은", SplitOptions::default());
        assert!(out[0].terminated);
        assert!(!out[1].terminated);
    }

    #[test]
    fn tail_for_carry() {
        let (done, tail) = split_with_tail("첫 문장. 두 번째는 다음 페이지로", SplitOptions::default());
        assert_eq!(done.len(), 1);
        assert_eq!(tail.as_deref(), Some("두 번째는 다음 페이지로"));

        let (done, tail) = split_with_tail("첫 문장. “대사가 다음 페이지로. 이어진다", SplitOptions::default());
        assert_eq!(done.len(), 1);
        assert_eq!(tail.as_deref(), Some("“대사가 다음 페이지로. 이어진다"));

        let (done, tail) = split_with_tail("완결. 문장.", SplitOptions::default());
        assert_eq!(done.len(), 2);
        assert!(tail.is_none());
    }
}
