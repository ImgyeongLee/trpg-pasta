//! 줄바꿈이 단어 중간에서 일어났는지 판단하기 위한 어휘 통계.
//!
//! 한글 PDF는 '글자 단위' 줄나눔(예: `초` / `상화들의`)과 '어절 단위' 줄나눔이 섞여 있다.
//! 같은 집합 안에서 줄 끝 조각 + 다음 줄 첫 글자로 시작하는 어절이 다른 곳에 나온다면
//! 단어가 잘린 것으로 보고 공백 없이 잇는다.

use std::collections::BTreeMap;

/// 홀로 어절이 될 수 없는 조사·어미. 줄이 이것으로 시작하면 앞 줄 끝 단어에 붙어야 한다.
const BOUND_MORPHEMES: &[&str] = &[
    "은",
    "는",
    "이",
    "가",
    "을",
    "를",
    "의",
    "에",
    "에서",
    "에게",
    "께",
    "께서",
    "한테",
    "로",
    "으로",
    "로서",
    "으로서",
    "와",
    "과",
    "도",
    "만",
    "까지",
    "부터",
    "처럼",
    "보다",
    "마저",
    "조차",
    "이나",
    "라고",
    "이라고",
    "이다",
    "다",
    "요",
    "죠",
    "니다",
    "습니다",
    "었다",
    "였다",
    "았다",
    "었고",
    "였고",
    "하다",
    "했다",
    "한다",
    "된다",
    "됐다",
    "되었다",
];

fn is_syllable(c: char) -> bool {
    ('\u{AC00}'..='\u{D7A3}').contains(&c)
}

#[derive(Debug, Default)]
pub struct Vocab {
    tokens: BTreeMap<String, usize>,
}

impl Vocab {
    pub fn from_lines<'a>(lines: impl IntoIterator<Item = &'a str>) -> Self {
        let mut tokens: BTreeMap<String, usize> = BTreeMap::new();
        for line in lines {
            for word in line.split_whitespace() {
                let word = word.trim_matches(|c: char| !c.is_alphanumeric());
                if word.chars().any(is_syllable) {
                    *tokens.entry(word.to_string()).or_default() += 1;
                }
            }
        }
        Self { tokens }
    }

    fn exact(&self, word: &str) -> usize {
        self.tokens.get(word).copied().unwrap_or(0)
    }

    fn prefixed(&self, prefix: &str) -> usize {
        self.tokens
            .range(prefix.to_string()..)
            .take_while(|(k, _)| k.starts_with(prefix))
            .map(|(_, n)| n)
            .sum()
    }

    /// `before`로 끝난 줄과 `after`로 시작하는 줄을 공백 없이 이어야 하는지.
    pub fn is_split_word(&self, before: &str, after: &str) -> bool {
        // 줄 끝 어절이 문장 부호 없이 한글로 끝나야 잘린 단어일 수 있다.
        let Some(head) = before.split_whitespace().last() else {
            return false;
        };
        if !head.chars().last().is_some_and(is_syllable) {
            return false;
        }
        let head = head.trim_start_matches(|c: char| !c.is_alphanumeric());
        let Some(first) = after.chars().next().filter(|c| is_syllable(*c)) else {
            return false;
        };
        let first_word = after
            .split_whitespace()
            .next()
            .unwrap_or("")
            .trim_end_matches(|c: char| !c.is_alphanumeric());
        if BOUND_MORPHEMES.contains(&first_word) {
            return true;
        }
        let probe = format!("{head}{first}");
        let joined = self.prefixed(&probe);
        // 줄 끝 조각 자신도 한 번 세어졌으므로, 이어 붙인 형태가 그보다 자주 나오면 잘린 단어로 본다.
        joined > 0 && joined >= self.exact(head)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_split_words() {
        let v = Vocab::from_lines([
            "벽에 걸린 초",
            "상화들의 눈이 초상화들의 눈이",
            "탐사자는 오래된 저택의 탐사",
            "자를 본다. 탐사자가 간다.",
        ]);
        assert!(v.is_split_word("벽에 걸린 초", "상화들의 눈이"));
        assert!(v.is_split_word("저택의 탐사", "자를 본다."));
        assert!(!v.is_split_word("탐사자는", "오래된 저택의"));
        assert!(!v.is_split_word("KPC가", "대답했다"));
        assert!(v.is_split_word("문을 열자 안쪽", "에서 바람이"));
        assert!(v.is_split_word("그는 문을 열었", "다. 그리고"));
        assert!(!v.is_split_word("문을 열었다.", "다음으로"));
    }
}
