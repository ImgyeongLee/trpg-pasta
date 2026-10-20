//! 사용자 데이터(매크로 등)를 앱 데이터 폴더의 JSON 파일로 저장한다.
//! 브라우저 저장소(localStorage)와 달리 개발/배포 빌드 사이에서도 유지된다.

use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager, Runtime};

/// 파일 이름으로 쓸 수 있는 저장소 이름인지 (경로 조작 방지).
fn valid_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 64 && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn path_for<R: Runtime>(app: &AppHandle<R>, name: &str) -> Result<PathBuf, String> {
    if !valid_name(name) {
        return Err(format!("잘못된 저장소 이름: {name}"));
    }
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(format!("{name}.json")))
}

pub fn load<R: Runtime>(app: &AppHandle<R>, name: &str) -> Result<Option<String>, String> {
    let path = path_for(app, name)?;
    match fs::read_to_string(&path) {
        Ok(contents) => Ok(Some(contents)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn save<R: Runtime>(app: &AppHandle<R>, name: &str, contents: &str) -> Result<(), String> {
    let path = path_for(app, name)?;
    // 쓰는 도중 앱이 꺼져도 기존 파일이 깨지지 않도록 임시 파일에 쓴 뒤 바꿔치기한다.
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, contents).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::valid_name;

    #[test]
    fn rejects_path_tricks() {
        assert!(valid_name("macros"));
        assert!(valid_name("scenario_notes-1"));
        assert!(!valid_name("../secret"));
        assert!(!valid_name("a/b"));
        assert!(!valid_name(""));
    }
}
