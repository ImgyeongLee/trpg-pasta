//! 쪽수, 반복되는 머리글/바닥글, 이미지 자리표시자 판별.

use regex::Regex;
use std::sync::LazyLock;

static PAGE_NUMBER: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    [
        r"^[-–—~\s]*\d{1,4}[-–—~\s]*$",
        r"^\d{1,4}\s*/\s*\d{1,4}$",
        r"^(?i:pp?)\.?\s*\d{1,4}$",
        r"^(?i:page)\s*\d{1,4}(\s*(?i:of|/)\s*\d{1,4})?$",
        r"^\d{1,4}\s*(쪽|페이지|(?i:p))$",
        r"^[\[(]\s*\d{1,4}\s*[\])]$",
    ]
    .iter()
    .map(|p| Regex::new(p).expect("valid page number regex"))
    .collect()
});

static ROMAN_PAGE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[-–—\s]*(?i:[ivxlcdm]{1,7})[-–—\s]*$").expect("valid roman regex"));

static MARKDOWN_IMAGE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^!\[([^\]]*)\]\(([^)]*)\)$").expect("valid markdown image regex"));

static IMAGE_PLACEHOLDER: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"^[\[(<【〈《]\s*(?:이미지|그림|사진|삽화|일러스트|지도|맵|(?i:image|img|figure|fig\.?|illust|map))[^\])>】〉》]*[\])>】〉》]$",
    )
    .expect("valid placeholder regex")
});

/// 줄 전체가 쪽수 표기인지. `allow_roman`은 PDF 여백 영역에서만 켠다.
pub fn is_page_number(text: &str, allow_roman: bool) -> bool {
    let t = text.trim();
    if t.is_empty() {
        return false;
    }
    PAGE_NUMBER.iter().any(|r| r.is_match(t)) || (allow_roman && ROMAN_PAGE.is_match(t))
}

/// 머리글/바닥글 비교용 정규화: 숫자는 `#`, 공백은 하나로.
pub fn furniture_key(text: &str) -> String {
    let mut out = String::new();
    let mut last_space = false;
    for c in text.trim().chars() {
        if c.is_whitespace() {
            if !last_space {
                out.push(' ');
            }
            last_space = true;
            continue;
        }
        last_space = false;
        if c.is_ascii_digit() {
            if !out.ends_with('#') {
                out.push('#');
            }
        } else {
            out.extend(c.to_lowercase());
        }
    }
    out
}

/// 텍스트 시나리오 속 이미지 자리표시자. 캡션(있으면)을 돌려준다.
pub fn image_placeholder(text: &str) -> Option<String> {
    let t = text.trim();
    if let Some(cap) = MARKDOWN_IMAGE.captures(t) {
        let alt = cap[1].trim();
        let src = cap[2].trim();
        return Some(if alt.is_empty() { src.to_string() } else { alt.to_string() });
    }
    if IMAGE_PLACEHOLDER.is_match(t) {
        return Some(t.to_string());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_numbers() {
        for t in [
            "12",
            "- 12 -",
            "— 3 —",
            "12 / 40",
            "p. 12",
            "P12",
            "Page 3",
            "page 3 of 10",
            "12쪽",
            "12 페이지",
            "[12]",
        ] {
            assert!(is_page_number(t, false), "{t}");
        }
        for t in ["12명의 탐사자", "제 1장", "1d100", "STR 50"] {
            assert!(!is_page_number(t, false), "{t}");
        }
        assert!(is_page_number("iv", true));
        assert!(!is_page_number("iv", false));
    }

    #[test]
    fn furniture_keys_ignore_digits() {
        assert_eq!(furniture_key("크툴루의 부름  12"), furniture_key("크툴루의 부름 13"));
    }

    #[test]
    fn placeholders() {
        assert_eq!(image_placeholder("![저택 지도](map.png)").as_deref(), Some("저택 지도"));
        assert_eq!(image_placeholder("[이미지: 저택 외관]").as_deref(), Some("[이미지: 저택 외관]"));
        assert_eq!(image_placeholder("<그림 3>").as_deref(), Some("<그림 3>"));
        assert!(image_placeholder("[주의] 이 장면은 비공개").is_none());
    }
}
