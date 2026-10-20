// 구글 문서 공유 링크로 시나리오 가져오기 (Rust: fetch_google_doc, fetch_google_doc_pdf).
import { invoke } from "@tauri-apps/api/core";

export interface FetchedDoc {
  /** 문서 id — 원본 보기에서 같은 문서를 PDF로 다시 받을 때 쓴다 */
  id: string;
  title: string;
  text: string;
}

/** 구글 문서(Docs) 링크처럼 보이는지 — 붙여넣기·끌어다 놓기에서 알아보는 용도 */
export function isGoogleDocUrl(text: string) {
  return /^\s*https?:\/\/docs\.google\.com\/document\/\S+\s*$/i.test(text);
}

export function googleDocUrl(id: string) {
  return `https://docs.google.com/document/d/${id}/edit`;
}

export function fetchGoogleDoc(url: string) {
  return invoke<FetchedDoc>("fetch_google_doc", { url: url.trim() });
}

// 원본 보기용 PDF는 앱이 켜져 있는 동안 기억해 두고 다시 받지 않는다.
const pdfCache = new Map<string, Promise<Uint8Array>>();

/** 같은 구글 문서를 PDF로 받는다 (서식·그림이 구글 문서 모양 그대로). */
export function fetchGoogleDocPdf(id: string): Promise<Uint8Array> {
  let cached = pdfCache.get(id);
  if (!cached) {
    cached = invoke<ArrayBuffer>("fetch_google_doc_pdf", { url: id }).then((buffer) => new Uint8Array(buffer));
    cached.catch(() => pdfCache.delete(id)); // 실패하면 다음에 다시 시도
    pdfCache.set(id, cached);
  }
  return cached;
}
