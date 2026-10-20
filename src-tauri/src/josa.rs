//! '탐사자', 'PC', 'KPC', 'PC1' 같은 라벨을 실제 캐릭터 이름으로 바꾸고,
//! 바뀐 이름의 받침에 맞게 뒤따르는 조사를 고친다.
//!
//! - `탐사자는` → `철수는` / `민준은`
//! - `PC가` → `민준이`, `PC(으)로` → `민준으로`, `PC은(는)` → `민준은`
//! - `KPC야,` → `민준아,` (호격), `KPC였다` → `민준이었다`

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::LazyLock;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BatchimMode {
    /// 이름의 마지막 글자로 자동 판단
    #[default]
    Auto,
    Yes,
    No,
    /// ㄹ 받침 ('으로' 대신 '로')
    Rieul,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubstitutionRule {
    pub label: String,
    pub name: String,
    #[serde(default)]
    pub batchim: BatchimMode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Final {
    Vowel,
    Consonant,
    Rieul,
}

struct Pair {
    consonant: &'static str,
    vowel: &'static str,
    /// '으로' 계열: ㄹ 받침 뒤에서는 모음 형태를 쓴다.
    ro: bool,
    /// 조사 뒤에 한글이 더 붙어 있으면 조사로 보지 않는다 ('이름'의 '이' 등).
    word_end: bool,
}

const fn p(consonant: &'static str, vowel: &'static str) -> Pair {
    Pair {
        consonant,
        vowel,
        ro: false,
        word_end: true,
    }
}

const PAIRS: &[Pair] = &[
    Pair {
        consonant: "으로부터",
        vowel: "로부터",
        ro: true,
        word_end: true,
    },
    Pair {
        consonant: "으로서",
        vowel: "로서",
        ro: true,
        word_end: true,
    },
    Pair {
        consonant: "으로써",
        vowel: "로써",
        ro: true,
        word_end: true,
    },
    Pair {
        consonant: "으로",
        vowel: "로",
        ro: true,
        word_end: true,
    },
    Pair {
        consonant: "이었",
        vowel: "였",
        ro: false,
        word_end: false,
    },
    p("이라고", "라고"),
    p("이라는", "라는"),
    p("이라면", "라면"),
    p("이라서", "라서"),
    p("이라도", "라도"),
    p("이라며", "라며"),
    p("이란", "란"),
    p("이랑", "랑"),
    p("이나마", "나마"),
    p("이나", "나"),
    p("이든지", "든지"),
    p("이든", "든"),
    p("이에요", "예요"),
    p("이여", "여"),
    p("이며", "며"),
    p("이지만", "지만"),
    p("이자", "자"),
    p("이고", "고"),
    p("이니까", "니까"),
    p("이다", "다"),
    p("이야", "야"),
    p("은", "는"),
    p("이", "가"),
    p("을", "를"),
    p("과", "와"),
    p("아", "야"),
];

fn is_syllable(c: char) -> bool {
    ('\u{AC00}'..='\u{D7A3}').contains(&c)
}

impl Pair {
    fn form(&self, fin: Final) -> &'static str {
        match fin {
            Final::Vowel => self.vowel,
            Final::Consonant => self.consonant,
            Final::Rieul if self.ro => self.vowel,
            Final::Rieul => self.consonant,
        }
    }

    /// `(이)라고`, `(으)로` 같은 생략 표기용 앞부분.
    fn optional_prefix(&self) -> Option<&'static str> {
        self.consonant.strip_suffix(self.vowel).filter(|pre| matches!(*pre, "이" | "으"))
    }
}

/// 숫자·영문 이름의 끝소리 (한국어 읽기 기준).
fn final_of_ascii(name: &str, c: char) -> Final {
    if let Some(d) = c.to_digit(10) {
        // 영 일 이 삼 사 오 육 칠 팔 구
        return match d {
            0 | 3 | 6 => Final::Consonant,
            1 | 7 | 8 => Final::Rieul,
            _ => Final::Vowel,
        };
    }
    let word: String = name.chars().rev().take_while(|c| c.is_ascii_alphabetic()).collect();
    let all_caps = word.len() > 1 && word.chars().all(|c| c.is_ascii_uppercase());
    let lower = c.to_ascii_lowercase();
    if all_caps {
        // 알파벳을 하나씩 읽는 약어: 엘(L), 엠(M), 엔(N), 알(R)
        return match lower {
            'l' | 'r' => Final::Rieul,
            'm' | 'n' => Final::Consonant,
            _ => Final::Vowel,
        };
    }
    let reversed: Vec<char> = word.to_ascii_lowercase().chars().collect();
    match lower {
        'l' => Final::Rieul,
        'm' | 'n' | 'b' | 'p' => Final::Consonant,
        'k' if reversed.get(1) == Some(&'c') => Final::Consonant,
        'g' if reversed.get(1) == Some(&'n') => Final::Consonant,
        _ => Final::Vowel,
    }
}

pub fn final_of(name: &str, mode: BatchimMode) -> Final {
    match mode {
        BatchimMode::Yes => return Final::Consonant,
        BatchimMode::No => return Final::Vowel,
        BatchimMode::Rieul => return Final::Rieul,
        BatchimMode::Auto => {}
    }
    // '민준(가명)'처럼 뒤에 붙은 괄호 설명은 건너뛰고 본 이름의 끝소리를 본다.
    let mut base = name.trim();
    while let Some(stripped) = base.strip_suffix(')').and_then(|b| b.rfind('(').map(|i| b[..i].trim_end())) {
        if stripped.is_empty() {
            break;
        }
        base = stripped;
    }
    let name = base;
    let Some(last) = name.chars().rev().find(|c| c.is_alphanumeric()) else {
        return Final::Vowel;
    };
    if is_syllable(last) {
        return match (last as u32 - 0xAC00) % 28 {
            0 => Final::Vowel,
            8 => Final::Rieul,
            _ => Final::Consonant,
        };
    }
    if last.is_ascii_alphanumeric() {
        return final_of_ascii(name, last);
    }
    Final::Vowel
}

fn starts_with_at(chars: &[char], at: usize, s: &str) -> bool {
    s.chars().enumerate().all(|(k, c)| chars.get(at + k) == Some(&c))
}

/// `at` 위치의 조사를 찾아 (소비한 글자 수, 바꿀 조사)를 돌려준다.
fn fix_particle(chars: &[char], at: usize, fin: Final) -> Option<(usize, String)> {
    fn consider(best: &mut Option<(usize, String)>, len: usize, out: String) {
        if best.as_ref().is_none_or(|(l, _)| len > *l) {
            *best = Some((len, out));
        }
    }
    let mut best: Option<(usize, String)> = None;

    // 병기 표기: 은(는), 는(은), (은)는, (이)가, (으)로, (이)라고 ...
    for pair in PAIRS {
        let (c, v) = (pair.consonant, pair.vowel);
        let mut patterns = vec![format!("{c}({v})"), format!("{v}({c})"), format!("({c}){v}"), format!("({v}){c}")];
        if let Some(pre) = pair.optional_prefix() {
            patterns.push(format!("({pre}){v}"));
        }
        for pat in patterns {
            if starts_with_at(chars, at, &pat) {
                consider(&mut best, pat.chars().count(), pair.form(fin).to_string());
            }
        }
    }
    if best.is_some() {
        return best;
    }

    for pair in PAIRS {
        for form in [pair.consonant, pair.vowel] {
            if !starts_with_at(chars, at, form) {
                continue;
            }
            let len = form.chars().count();
            let next = chars.get(at + len).copied();
            if pair.word_end && next.is_some_and(is_syllable) {
                continue;
            }
            let mut out = pair.form(fin).to_string();
            // '야'는 호격(아/야)과 서술격(이야/야) 둘 다 될 수 있다.
            if form == "야" {
                let vocative = matches!(next, Some(',' | '!' | '~' | '…' | '，' | '！'));
                out = match (vocative, fin) {
                    (_, Final::Vowel) => "야".into(),
                    (true, _) => "아".into(),
                    (false, _) => "이야".into(),
                };
            }
            consider(&mut best, len, out);
        }
    }
    best
}

fn is_word_char(c: Option<char>) -> bool {
    c.is_some_and(|c| c.is_ascii_alphanumeric())
}

struct Prepared {
    label: Vec<char>,
    name: String,
    fin: Final,
    ascii_start: bool,
    ascii_end: bool,
}

/// 여러 문장에 같은 규칙을 적용한다.
pub fn apply_all(texts: &[String], rules: &[SubstitutionRule]) -> Vec<String> {
    let mut prepared: Vec<Prepared> = rules
        .iter()
        .filter(|r| !r.label.trim().is_empty() && !r.name.trim().is_empty())
        .map(|r| {
            let label: Vec<char> = r.label.trim().chars().collect();
            Prepared {
                ascii_start: label.first().is_some_and(|c| c.is_ascii_alphanumeric()),
                ascii_end: label.last().is_some_and(|c| c.is_ascii_alphanumeric()),
                name: r.name.trim().to_string(),
                fin: final_of(r.name.trim(), r.batchim),
                label,
            }
        })
        .collect();
    // 긴 라벨 우선 (PC1 > PC, 탐사자들 > 탐사자)
    prepared.sort_by_key(|p| std::cmp::Reverse(p.label.len()));
    texts.iter().map(|t| apply_prepared(t, &prepared)).collect()
}

pub fn apply(text: &str, rules: &[SubstitutionRule]) -> String {
    apply_all(&[text.to_string()], rules).pop().unwrap_or_default()
}

fn apply_prepared(text: &str, rules: &[Prepared]) -> String {
    if rules.is_empty() {
        return text.to_string();
    }
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    'outer: while i < chars.len() {
        for rule in rules {
            let n = rule.label.len();
            if i + n > chars.len() || chars[i..i + n] != rule.label[..] {
                continue;
            }
            // KPC 속의 PC, PC10 속의 PC1 같은 부분 일치는 건너뛴다.
            if rule.ascii_start && i > 0 && is_word_char(Some(chars[i - 1])) {
                continue;
            }
            if rule.ascii_end && is_word_char(chars.get(i + n).copied()) {
                continue;
            }
            out.push_str(&rule.name);
            let mut j = i + n;
            if let Some((len, particle)) = fix_particle(&chars, j, rule.fin) {
                out.push_str(&particle);
                j += len;
            }
            i = j;
            continue 'outer;
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LabelCount {
    pub label: String,
    pub count: usize,
}

static LABEL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:^|[^A-Za-z0-9])(KPC\d*|PC\d*|PL\d*|HO\d+)(?:[^A-Za-z0-9]|$)|(탐사자\s?\d+|탐사자|수사관\s?\d*|플레이어\s?\d+)")
        .expect("valid label regex")
});

/// 시나리오에 등장하는 치환 후보 라벨과 등장 횟수.
pub fn detect_labels(texts: &[String]) -> Vec<LabelCount> {
    let mut counts: HashMap<String, usize> = HashMap::new();
    for text in texts {
        // 경계 문자를 공유하는 연속 라벨(PC1,PC2)도 잡도록 직접 위치를 옮겨 가며 찾는다.
        let mut at = 0;
        while let Some(cap) = LABEL.captures_at(text, at) {
            let m = cap.get(1).or_else(|| cap.get(2)).expect("one group matches");
            *counts.entry(m.as_str().to_string()).or_default() += 1;
            at = m.end();
        }
    }
    let mut out: Vec<LabelCount> = counts.into_iter().map(|(label, count)| LabelCount { label, count }).collect();
    out.sort_by(|a, b| b.count.cmp(&a.count).then(a.label.cmp(&b.label)));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(label: &str, name: &str) -> SubstitutionRule {
        SubstitutionRule {
            label: label.into(),
            name: name.into(),
            batchim: BatchimMode::Auto,
        }
    }

    #[test]
    fn finals() {
        assert_eq!(final_of("철수", BatchimMode::Auto), Final::Vowel);
        assert_eq!(final_of("민준", BatchimMode::Auto), Final::Consonant);
        assert_eq!(final_of("하늘", BatchimMode::Auto), Final::Rieul);
        assert_eq!(final_of("John", BatchimMode::Auto), Final::Consonant);
        assert_eq!(final_of("Paul", BatchimMode::Auto), Final::Rieul);
        assert_eq!(final_of("Mike", BatchimMode::Auto), Final::Vowel);
        assert_eq!(final_of("KPC", BatchimMode::Auto), Final::Vowel);
        assert_eq!(final_of("민준(가명)", BatchimMode::Auto), Final::Consonant);
        assert_eq!(final_of("철수 (KPC)", BatchimMode::Auto), Final::Vowel);
        assert_eq!(final_of("Alice", BatchimMode::Yes), Final::Consonant);
    }

    #[test]
    fn particles_follow_the_new_name() {
        let rules = [rule("탐사자", "민준")];
        assert_eq!(
            apply("탐사자는 탐사자가 탐사자를 탐사자와 탐사자로", &rules),
            "민준은 민준이 민준을 민준과 민준으로"
        );
        let rules = [rule("PC", "철수")];
        assert_eq!(apply("PC은 PC이 PC을 PC과 PC으로", &rules), "철수는 철수가 철수를 철수와 철수로");
        let rules = [rule("PC", "하늘")];
        assert_eq!(apply("PC로 PC가 PC로부터", &rules), "하늘로 하늘이 하늘로부터");
    }

    #[test]
    fn copula_and_vocative() {
        let rules = [rule("KPC", "민준")];
        assert_eq!(
            apply("KPC였다. KPC라고 했다. KPC야, 일어나! 범인은 KPC야.", &rules),
            "민준이었다. 민준이라고 했다. 민준아, 일어나! 범인은 민준이야."
        );
        let rules = [rule("KPC", "철수")];
        assert_eq!(apply("KPC이었다. KPC아, KPC이야.", &rules), "철수였다. 철수야, 철수야.");
    }

    #[test]
    fn dual_notation() {
        let rules = [rule("PC", "민준")];
        assert_eq!(
            apply("PC은(는) PC(이)가 PC를(을) PC(으)로 PC(이)라고", &rules),
            "민준은 민준이 민준을 민준으로 민준이라고"
        );
        let rules = [rule("PC", "철수")];
        assert_eq!(apply("PC은(는) PC(은)는 PC이(가)", &rules), "철수는 철수는 철수가");
    }

    #[test]
    fn label_boundaries() {
        let rules = [rule("PC", "철수"), rule("KPC", "민준"), rule("PC1", "영희")];
        assert_eq!(
            apply("PC와 KPC, PC1은 NPC를 만난다. PC10", &rules),
            "철수와 민준, 영희는 NPC를 만난다. PC10"
        );
    }

    #[test]
    fn non_particle_words_are_kept() {
        let rules = [rule("탐사자", "철수")];
        assert_eq!(
            apply("탐사자이름 탐사자에게 탐사자의 탐사자들", &rules),
            "철수이름 철수에게 철수의 철수들"
        );
    }

    #[test]
    fn detects_labels() {
        let texts = vec!["PC1과 PC2, KPC는 탐사자 전원과 만난다. PC1".to_string(), "NPC와 PC".to_string()];
        let found: Vec<(String, usize)> = detect_labels(&texts).into_iter().map(|l| (l.label, l.count)).collect();
        assert_eq!(
            found,
            [
                ("PC1".into(), 2),
                ("KPC".into(), 1),
                ("PC".into(), 1),
                ("PC2".into(), 1),
                ("탐사자".into(), 1)
            ]
        );
    }
}
