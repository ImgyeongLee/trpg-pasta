//! 정리 결과 내보내기: 텍스트 파일, 그림 파일.
//!
//! 저장 위치는 항상 여기(Rust)에서 띄운 저장 창으로만 고른다.
//! 웹뷰 쪽에는 "임의 경로에 쓰기" 기능을 열어 주지 않는다.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Runtime, State};
use tauri_plugin_dialog::DialogExt;

/// 「그림 모두 저장」에서 고른 폴더
#[derive(Default)]
pub struct ExportFolder(pub Mutex<Option<PathBuf>>);

/// 파일 이름으로 쓸 수 없는 글자를 바꾸고, 경로 조작(../, 폴더 구분자)을 막는다.
pub fn sanitize_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').trim();
    let limited: String = trimmed.chars().take(120).collect();
    if limited.is_empty() { "file".to_string() } else { limited }
}

/// 같은 이름이 있으면 덮어쓰지 않고 `이름 (2).확장자` 식으로 비켜 간다.
pub fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_string(), format!(".{e}")),
        _ => (name.to_string(), String::new()),
    };
    (2..)
        .map(|n| dir.join(format!("{stem} ({n}){ext}")))
        .find(|p| !p.exists())
        .expect("an unused name exists")
}

/// encodeURIComponent로 넘어온 헤더 값을 되돌린다.
pub fn percent_decode(s: &str) -> String {
    fn hex(b: u8) -> Option<u8> {
        (b as char).to_digit(16).map(|d| d as u8)
    }
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && i + 2 < bytes.len()
            && let (Some(hi), Some(lo)) = (hex(bytes[i + 1]), hex(bytes[i + 2]))
        {
            out.push(hi << 4 | lo);
            i += 3;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn raw_body(request: &Request<'_>) -> Result<Vec<u8>, String> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(bytes.clone()),
        _ => Err("파일 내용이 비어 있습니다".into()),
    }
}

fn header_name(request: &Request<'_>) -> Result<String, String> {
    let value = request.headers().get("x-file-name").ok_or("파일 이름이 없습니다")?;
    let value = value.to_str().map_err(|e| e.to_string())?;
    Ok(sanitize_file_name(&percent_decode(value)))
}

fn write_atomic(path: &Path, contents: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("tmp-trpg");
    fs::write(&tmp, contents).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// 저장 창을 띄워 텍스트 파일로 저장한다. 취소하면 None.
pub fn save_text<R: Runtime>(app: &AppHandle<R>, default_name: &str, contents: &str) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .set_title("텍스트 파일로 저장")
        .set_file_name(sanitize_file_name(default_name))
        .add_filter("텍스트", &["txt"])
        .blocking_save_file();
    let Some(picked) = picked else { return Ok(None) };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    write_atomic(&path, contents.as_bytes())?;
    Ok(Some(path.display().to_string()))
}

/// 저장 창을 띄워 그림 하나를 저장한다. 본문은 PNG 바이트, 이름은 `x-file-name` 헤더.
pub fn save_image<R: Runtime>(app: &AppHandle<R>, request: &Request<'_>) -> Result<Option<String>, String> {
    let bytes = raw_body(request)?;
    let name = header_name(request)?;
    let picked = app
        .dialog()
        .file()
        .set_title("그림 저장")
        .set_file_name(name)
        .add_filter("PNG 그림", &["png"])
        .blocking_save_file();
    let Some(picked) = picked else { return Ok(None) };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    write_atomic(&path, &bytes)?;
    Ok(Some(path.display().to_string()))
}

/// 「그림 모두 저장」: 폴더를 고르게 하고 기억해 둔다. 취소하면 None.
pub fn choose_folder<R: Runtime>(app: &AppHandle<R>, state: &State<'_, ExportFolder>) -> Result<Option<String>, String> {
    let picked = app.dialog().file().set_title("그림을 저장할 폴더").blocking_pick_folder();
    let Some(picked) = picked else { return Ok(None) };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    let shown = path.display().to_string();
    *state.0.lock().map_err(|e| e.to_string())? = Some(path);
    Ok(Some(shown))
}

/// 고른 폴더에 그림 하나를 쓴다. 같은 이름이 있으면 비켜 간다. 실제로 쓴 파일 이름을 돌려준다.
pub fn write_into_folder(state: &State<'_, ExportFolder>, request: &Request<'_>) -> Result<String, String> {
    let dir = state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or("먼저 폴더를 골라 주세요")?;
    let name = header_name(request)?;
    let path = unique_path(&dir, &name);
    write_atomic(&path, &raw_body(request)?)?;
    Ok(path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or(name))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_names() {
        assert_eq!(sanitize_file_name("그림03_12쪽.png"), "그림03_12쪽.png");
        assert_eq!(sanitize_file_name("../../etc/passwd"), "_.._etc_passwd");
        assert_eq!(sanitize_file_name("a/b\\c:d?.txt"), "a_b_c_d_.txt");
        assert_eq!(sanitize_file_name("  ...  "), "file");
    }

    #[test]
    fn decodes_percent_encoding() {
        assert_eq!(percent_decode("%EA%B7%B8%EB%A6%BC03.png"), "그림03.png");
        assert_eq!(percent_decode("plain.png"), "plain.png");
        assert_eq!(percent_decode("100%"), "100%");
    }

    #[test]
    fn avoids_overwriting() {
        let dir = std::env::temp_dir().join(format!("trpg-export-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("a.png"), b"x").unwrap();
        fs::write(dir.join("a (2).png"), b"x").unwrap();
        assert_eq!(unique_path(&dir, "a.png").file_name().unwrap(), "a (3).png");
        assert_eq!(unique_path(&dir, "b.png").file_name().unwrap(), "b.png");
        fs::remove_dir_all(&dir).unwrap();
    }
}
