//! 구글 문서 공유 링크로 시나리오 가져오기.
//!
//! 「링크가 있는 모든 사용자」에게 공유한 문서는 로그인 없이
//! `https://docs.google.com/document/d/<id>/export?format=txt` 로 글자를 내려받아 정리하고,
//! 원본 보기에는 같은 문서를 `format=pdf`로 받아 서식·그림 그대로 보여준다.

use std::time::Duration;

use serde::Serialize;

use crate::export::percent_decode;

/// 받을 수 있는 최대 크기: 글자만(정리용)과 PDF(원본 보기용, 그림 포함)
const MAX_TEXT_BYTES: usize = 20 * 1024 * 1024;
const MAX_PDF_BYTES: usize = 100 * 1024 * 1024;

const NOT_SHARED: &str = "이 문서는 공유가 꺼져 있어 가져올 수 없습니다. 구글 문서에서 「공유 → 일반 액세스」를 「링크가 있는 모든 사용자 (뷰어)」로 바꾼 뒤 다시 시도해 주세요.";

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FetchedDoc {
    /// 문서 id — 원본 보기에서 같은 문서를 PDF로 다시 받을 때 쓴다
    pub id: String,
    pub title: String,
    pub text: String,
}

fn is_id_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '-' || c == '_'
}

/// 공유 링크(또는 문서 id)에서 문서 id를 꺼낸다.
pub fn doc_id(input: &str) -> Result<String, String> {
    let s = input.trim();
    if s.contains("docs.google.com") && !s.contains("/document/") {
        return Err("구글 문서(Docs) 링크가 아닙니다. 스프레드시트·프레젠테이션은 아직 지원하지 않아요.".into());
    }
    let candidate = if let Some(pos) = s.find("/d/") {
        s[pos + 3..].chars().take_while(|c| is_id_char(*c)).collect::<String>()
    } else if let Some(pos) = s.find("id=") {
        s[pos + 3..].chars().take_while(|c| is_id_char(*c)).collect()
    } else {
        s.to_string()
    };
    if candidate.len() >= 20 && candidate.chars().all(is_id_char) {
        Ok(candidate)
    } else {
        Err("구글 문서 링크를 알아볼 수 없습니다. 주소창의 https://docs.google.com/document/d/… 링크를 붙여넣어 주세요.".into())
    }
}

/// `Content-Disposition`에서 파일 이름(=문서 제목)을 꺼낸다. 한글 제목은 `filename*=UTF-8''…`로 온다.
pub fn title_from_disposition(header: &str) -> Option<String> {
    let mut plain = None;
    for part in header.split(';').map(str::trim) {
        if let Some(v) = part.strip_prefix("filename*=") {
            let v = v.trim_matches('"');
            let encoded = v.split_once("''").map_or(v, |(_, rest)| rest);
            return Some(strip_ext(&percent_decode(encoded)));
        }
        if let Some(v) = part.strip_prefix("filename=") {
            plain = Some(strip_ext(v.trim_matches('"')));
        }
    }
    plain
}

fn strip_ext(name: &str) -> String {
    name.strip_suffix(".txt")
        .or_else(|| name.strip_suffix(".pdf"))
        .unwrap_or(name)
        .trim()
        .to_string()
}

fn clean_text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes)
        .trim_start_matches('\u{feff}')
        .replace("\r\n", "\n")
        .replace('\r', "\n")
}

/// 받은 파일과 (헤더에 실린) 문서 제목
struct Download {
    title: String,
    bytes: Vec<u8>,
}

/// 공유 문서를 `format`(txt, pdf …)으로 내려받는다. 공유가 꺼졌거나 없는 문서면 알기 쉬운 오류를 낸다.
async fn download(id: &str, format: &str, max_bytes: usize) -> Result<Download, String> {
    let url = format!("https://docs.google.com/document/d/{id}/export?format={format}");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .user_agent("TRPG-Package")
        .build()
        .map_err(|e| e.to_string())?;
    let response = client.get(&url).send().await.map_err(|e| {
        if e.is_timeout() || e.is_connect() {
            "구글에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.".to_string()
        } else {
            format!("구글 문서를 받지 못했습니다: {e}")
        }
    })?;

    let status = response.status();
    // 공유가 꺼진 문서는 로그인 화면으로 넘어가거나 권한 오류가 난다.
    if response.url().host_str().is_some_and(|h| h.starts_with("accounts.")) || status.as_u16() == 401 || status.as_u16() == 403 {
        return Err(NOT_SHARED.into());
    }
    if status.as_u16() == 404 {
        return Err("문서를 찾을 수 없습니다. 링크가 맞는지 확인해 주세요.".into());
    }
    if !status.is_success() {
        return Err(format!("구글 문서를 받지 못했습니다 (HTTP {status})"));
    }
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    if content_type.starts_with("text/html") {
        return Err(NOT_SHARED.into());
    }
    let too_big = || format!("문서가 너무 큽니다 ({} MB 초과).", max_bytes / 1024 / 1024);
    if response.content_length().is_some_and(|n| n as usize > max_bytes) {
        return Err(too_big());
    }
    let title = response
        .headers()
        .get("content-disposition")
        .and_then(|v| v.to_str().ok())
        .and_then(title_from_disposition)
        .unwrap_or_else(|| "구글 문서".to_string());
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("구글 문서를 받는 중에 끊겼습니다: {e}"))?;
    if bytes.len() > max_bytes {
        return Err(too_big());
    }
    Ok(Download {
        title,
        bytes: bytes.to_vec(),
    })
}

/// 문서의 글자를 가져온다 (정리용).
pub async fn fetch(input: &str) -> Result<FetchedDoc, String> {
    let id = doc_id(input)?;
    let download = download(&id, "txt", MAX_TEXT_BYTES).await?;
    let text = clean_text(&download.bytes);
    if text.trim().is_empty() {
        return Err("문서에 글자가 없습니다.".into());
    }
    Ok(FetchedDoc {
        id,
        title: download.title,
        text,
    })
}

/// 문서를 PDF로 가져온다 (원본 보기용 — 서식·그림이 구글 문서 모양 그대로).
pub async fn fetch_pdf(input: &str) -> Result<Vec<u8>, String> {
    let id = doc_id(input)?;
    let download = download(&id, "pdf", MAX_PDF_BYTES).await?;
    if !download.bytes.starts_with(b"%PDF") {
        return Err("구글 문서를 PDF로 받지 못했습니다.".into());
    }
    Ok(download.bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-xy";

    #[test]
    fn parses_doc_links() {
        for link in [
            format!("https://docs.google.com/document/d/{ID}/edit?usp=sharing"),
            format!("https://docs.google.com/document/d/{ID}/edit#heading=h.abc"),
            format!("https://docs.google.com/document/u/0/d/{ID}/"),
            format!("  https://docs.google.com/document/d/{ID}  "),
            format!("https://drive.google.com/open?id={ID}"),
            ID.to_string(),
        ] {
            assert_eq!(doc_id(&link).as_deref(), Ok(ID), "{link}");
        }
    }

    #[test]
    fn rejects_other_links() {
        assert!(
            doc_id(&format!("https://docs.google.com/spreadsheets/d/{ID}/edit"))
                .unwrap_err()
                .contains("스프레드시트")
        );
        assert!(doc_id("https://example.com/hello").is_err());
        assert!(doc_id("짧은글").is_err());
    }

    #[test]
    fn reads_title_from_disposition() {
        assert_eq!(
            title_from_disposition(
                "attachment; filename=\"___.txt\"; filename*=UTF-8''%EC%96%B4%EB%91%A0%20%EC%86%8D%EC%9D%98%20%EC%A0%80%ED%83%9D.txt"
            )
            .as_deref(),
            Some("어둠 속의 저택")
        );
        assert_eq!(
            title_from_disposition("attachment; filename=\"Mansion.txt\"").as_deref(),
            Some("Mansion")
        );
        assert_eq!(title_from_disposition("inline"), None);
    }

    #[test]
    fn cleans_bom_and_line_endings() {
        assert_eq!(clean_text("\u{feff}첫 줄\r\n둘째 줄\r셋째".as_bytes()), "첫 줄\n둘째 줄\n셋째");
    }
}
