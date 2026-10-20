// SPDX-License-Identifier: AGPL-3.0-only

mod export;
pub mod gdocs;
pub mod josa;
pub mod scenario;
mod session;
mod store;

use josa::{LabelCount, SubstitutionRule};
use scenario::{ChunkOutput, PdfChunkInput, TextChunkInput};

#[tauri::command]
async fn process_pdf_chunk(input: PdfChunkInput) -> ChunkOutput {
    scenario::process_pdf_chunk(input)
}

#[tauri::command]
async fn process_text_chunk(input: TextChunkInput) -> ChunkOutput {
    scenario::process_text_chunk(input)
}

#[tauri::command]
async fn apply_substitutions(texts: Vec<String>, rules: Vec<SubstitutionRule>) -> Vec<String> {
    josa::apply_all(&texts, &rules)
}

#[tauri::command]
async fn detect_labels(texts: Vec<String>) -> Vec<LabelCount> {
    josa::detect_labels(&texts)
}

#[tauri::command]
async fn load_data(app: tauri::AppHandle, name: String) -> Result<Option<String>, String> {
    store::load(&app, &name)
}

#[tauri::command]
async fn save_data(app: tauri::AppHandle, name: String, contents: String) -> Result<(), String> {
    store::save(&app, &name, &contents)
}

#[tauri::command]
async fn save_text_file(app: tauri::AppHandle, default_name: String, contents: String) -> Result<Option<String>, String> {
    export::save_text(&app, &default_name, &contents)
}

#[tauri::command]
async fn save_image_file(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<Option<String>, String> {
    export::save_image(&app, &request)
}

#[tauri::command]
async fn choose_export_folder(app: tauri::AppHandle, state: tauri::State<'_, export::ExportFolder>) -> Result<Option<String>, String> {
    export::choose_folder(&app, &state)
}

#[tauri::command]
async fn write_export_file(state: tauri::State<'_, export::ExportFolder>, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    export::write_into_folder(&state, &request)
}

#[tauri::command]
async fn save_session(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<u64, String> {
    session::save(&app, &request)
}

#[tauri::command]
async fn list_sessions(app: tauri::AppHandle) -> Result<Vec<serde_json::Value>, String> {
    session::list(&app)
}

#[tauri::command]
async fn load_session(app: tauri::AppHandle, id: String) -> Result<String, String> {
    session::load(&app, &id)
}

#[tauri::command]
async fn delete_session(app: tauri::AppHandle, id: String) -> Result<(), String> {
    session::delete(&app, &id)
}

#[tauri::command]
async fn export_session(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<Option<String>, String> {
    session::export(&app, &request)
}

/// 세이브 파일(.trpgsave, 또는 .json)을 읽어 JSON 글자로 돌려준다.
#[tauri::command]
async fn decode_session(request: tauri::ipc::Request<'_>) -> Result<String, String> {
    match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => session::decode(bytes),
        _ => Err("내용이 비어 있습니다".into()),
    }
}

/// 구글 문서 공유 링크에서 글자를 가져온다 (「링크가 있는 모든 사용자」 공유 문서만).
#[tauri::command]
async fn fetch_google_doc(url: String) -> Result<gdocs::FetchedDoc, String> {
    gdocs::fetch(&url).await
}

/// 원본 보기용: 같은 구글 문서를 PDF 바이트로 돌려준다 (JSON으로 감싸지 않고 그대로).
#[tauri::command]
async fn fetch_google_doc_pdf(url: String) -> Result<tauri::ipc::Response, String> {
    gdocs::fetch_pdf(&url).await.map(tauri::ipc::Response::new)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(export::ExportFolder::default())
        .invoke_handler(tauri::generate_handler![
            process_pdf_chunk,
            process_text_chunk,
            apply_substitutions,
            detect_labels,
            load_data,
            save_data,
            save_text_file,
            save_image_file,
            choose_export_folder,
            write_export_file,
            save_session,
            list_sessions,
            load_session,
            delete_session,
            export_session,
            decode_session,
            fetch_google_doc,
            fetch_google_doc_pdf
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
