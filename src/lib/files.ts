// 파일로 내보내기. 저장 위치는 Rust가 띄우는 저장 창에서만 고른다 (src-tauri/src/export.rs).
import { invoke } from "@tauri-apps/api/core";

async function bytesOf(url: string): Promise<Uint8Array> {
  return new Uint8Array(await (await fetch(url)).arrayBuffer());
}

const nameHeader = (name: string) => ({ headers: { "x-file-name": encodeURIComponent(name) } });

/** 저장 창을 띄워 텍스트 파일로 저장. 저장한 경로, 취소하면 null. */
export function saveTextFile(defaultName: string, contents: string) {
  return invoke<string | null>("save_text_file", { defaultName, contents });
}

/** 저장 창을 띄워 그림(blob URL의 PNG) 하나를 저장. 저장한 경로, 취소하면 null. */
export async function saveImageFile(name: string, url: string) {
  return invoke<string | null>("save_image_file", await bytesOf(url), nameHeader(name));
}

/** 「그림 모두 저장」용 폴더 고르기. 고른 경로, 취소하면 null. */
export function chooseExportFolder() {
  return invoke<string | null>("choose_export_folder");
}

/** 고른 폴더에 그림 하나를 쓴다 (같은 이름이 있으면 비켜 감). 실제 파일 이름을 돌려준다. */
export async function writeExportFile(name: string, url: string) {
  return invoke<string>("write_export_file", await bytesOf(url), nameHeader(name));
}
