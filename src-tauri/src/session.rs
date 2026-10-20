//! 작업 세이브.
//!
//! 정리 중인 시나리오를 앱 데이터 폴더의 `sessions/<id>.trpgsave`에 저장한다 (사용자가 저장할 때만, 자동 저장 없음).
//! 세이브 파일은 gzip으로 압축한 JSON이다. 원본 PDF와 잘라낸 그림은 넣지 않고
//! (그림은 PDF 속 위치만 기록해 두었다가 원본을 다시 연결하면 잘라낸다) 가볍게 유지한다.
//! 최근 작업 목록을 빨리 보여주려고 작은 `<id>.meta.json`을 함께 둔다.

use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;

use flate2::Compression;
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use serde_json::Value;
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_dialog::DialogExt;

use crate::export::{percent_decode, sanitize_file_name};

pub const EXTENSION: &str = "trpgsave";
/// 압축 해제 상한 (압축 폭탄 방지)
const MAX_DECOMPRESSED: u64 = 256 * 1024 * 1024;

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn sessions_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("sessions");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub fn gzip(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::best());
    encoder.write_all(bytes).map_err(|e| e.to_string())?;
    encoder.finish().map_err(|e| e.to_string())
}

/// gzip이면 풀고, 아니면(사람이 고친 .json 등) 그대로 글자로 읽는다.
pub fn decode(bytes: &[u8]) -> Result<String, String> {
    let raw = if bytes.starts_with(&[0x1f, 0x8b]) {
        let mut out = Vec::new();
        GzDecoder::new(bytes)
            .take(MAX_DECOMPRESSED)
            .read_to_end(&mut out)
            .map_err(|e| format!("세이브 파일을 풀지 못했습니다: {e}"))?;
        out
    } else {
        bytes.to_vec()
    };
    String::from_utf8(raw).map_err(|_| "세이브 파일 형식이 아닙니다".to_string())
}

fn raw_body(request: &Request<'_>) -> Result<Vec<u8>, String> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(bytes.clone()),
        _ => Err("내용이 비어 있습니다".into()),
    }
}

fn header(request: &Request<'_>, name: &str) -> Result<String, String> {
    let value = request.headers().get(name).ok_or(format!("{name} 헤더가 없습니다"))?;
    Ok(percent_decode(value.to_str().map_err(|e| e.to_string())?))
}

fn write_atomic(path: &PathBuf, contents: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("tmp-trpg");
    fs::write(&tmp, contents).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// 자동 저장. 본문은 세이브 JSON, `x-session-id`와 `x-session-meta`(목록용 요약) 헤더.
/// 압축된 크기를 돌려준다.
pub fn save<R: Runtime>(app: &AppHandle<R>, request: &Request<'_>) -> Result<u64, String> {
    let id = header(request, "x-session-id")?;
    if !valid_id(&id) {
        return Err("잘못된 세이브 id".into());
    }
    let compressed = gzip(&raw_body(request)?)?;
    let dir = sessions_dir(app)?;
    write_atomic(&dir.join(format!("{id}.{EXTENSION}")), &compressed)?;

    let mut meta: Value = serde_json::from_str(&header(request, "x-session-meta")?).map_err(|e| e.to_string())?;
    if let Value::Object(map) = &mut meta {
        map.insert("id".into(), Value::String(id.clone()));
        map.insert("size".into(), Value::from(compressed.len() as u64));
    }
    write_atomic(&dir.join(format!("{id}.meta.json")), meta.to_string().as_bytes())?;
    Ok(compressed.len() as u64)
}

/// 최근 작업 목록 (최근에 저장한 순)
pub fn list<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<Value>, String> {
    let dir = sessions_dir(app)?;
    let mut metas: Vec<Value> = fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| {
            let path = entry.ok()?.path();
            let name = path.file_name()?.to_str()?;
            if !name.ends_with(".meta.json") {
                return None;
            }
            // 세이브 본문이 없는 요약은 건너뛴다.
            let id = name.trim_end_matches(".meta.json");
            if !dir.join(format!("{id}.{EXTENSION}")).exists() {
                return None;
            }
            serde_json::from_str(&fs::read_to_string(&path).ok()?).ok()
        })
        .collect();
    metas.sort_by(|a, b| {
        b["updatedAt"]
            .as_f64()
            .unwrap_or(0.0)
            .total_cmp(&a["updatedAt"].as_f64().unwrap_or(0.0))
    });
    Ok(metas)
}

pub fn load<R: Runtime>(app: &AppHandle<R>, id: &str) -> Result<String, String> {
    if !valid_id(id) {
        return Err("잘못된 세이브 id".into());
    }
    let bytes = fs::read(sessions_dir(app)?.join(format!("{id}.{EXTENSION}"))).map_err(|e| e.to_string())?;
    decode(&bytes)
}

pub fn delete<R: Runtime>(app: &AppHandle<R>, id: &str) -> Result<(), String> {
    if !valid_id(id) {
        return Err("잘못된 세이브 id".into());
    }
    let dir = sessions_dir(app)?;
    for name in [format!("{id}.{EXTENSION}"), format!("{id}.meta.json")] {
        let path = dir.join(name);
        if path.exists() {
            fs::remove_file(path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// 세이브 파일로 내보내기 (저장 창). 저장한 경로, 취소하면 None.
pub fn export<R: Runtime>(app: &AppHandle<R>, request: &Request<'_>) -> Result<Option<String>, String> {
    let name = sanitize_file_name(&header(request, "x-file-name")?);
    let compressed = gzip(&raw_body(request)?)?;
    let picked = app
        .dialog()
        .file()
        .set_title("세이브 파일로 저장")
        .set_file_name(name)
        .add_filter("TRPG Pasta 세이브", &[EXTENSION])
        .blocking_save_file();
    let Some(picked) = picked else { return Ok(None) };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    write_atomic(&path, &compressed)?;
    Ok(Some(path.display().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gzip_round_trip_and_plain_json() {
        let json = r#"{"format":"trpg-package-session","sections":[{"b":[{"t":"s","x":"탐사자는 문을 연다."}]}]}"#.repeat(50);
        let packed = gzip(json.as_bytes()).unwrap();
        assert!(packed.len() < json.len() / 5, "반복이 많은 세이브는 크게 줄어야 한다");
        assert_eq!(decode(&packed).unwrap(), json);
        assert_eq!(decode(json.as_bytes()).unwrap(), json);
    }

    #[test]
    fn rejects_bad_ids() {
        assert!(valid_id("mabc123-x9"));
        assert!(!valid_id("../x"));
        assert!(!valid_id(""));
    }
}
