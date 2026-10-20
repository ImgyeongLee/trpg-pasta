// 작업 세이브: 앱 안 저장(직접 저장, 닫을 때 확인) + 세이브 파일(.trpgsave) 내보내기/열기.
// 실제 압축·파일 쓰기는 Rust(src-tauri/src/session.rs)가 한다.

import { invoke } from "@tauri-apps/api/core";
import { dialog } from "$lib/ui/dialog.svelte";
import { exportBaseName } from "./export.svelte";
import { newSessionId, scenario } from "./state.svelte";
import type { SaveFile, SessionMeta } from "./types";

export const SAVE_EXTENSION = "trpgsave";

const encoder = new TextEncoder();
const headerValue = (v: string) => encodeURIComponent(v);

function meta(file: SaveFile): Omit<SessionMeta, "id" | "size"> {
  let total = 0;
  for (const s of file.sections) {
    total += s.b.length;
  }
  return { name: file.name, updatedAt: file.savedAt, total, sections: file.sections.length, sourceKind: file.source?.kind ?? null };
}

class Sessions {
  list = $state<SessionMeta[]>([]);
  status = $state<"idle" | "saving" | "saved" | "error">("idle");
  /** 마지막 저장 뒤로 바뀐 내용이 있는지 */
  dirty = $state(false);
  savedAt = $state<number | null>(null);
  /** 마지막 세이브의 압축된 크기 (바이트) */
  size = $state<number | null>(null);
  error = $state<string | null>(null);

  #saving: Promise<void> | null = null;
  #again = false;
  /** 마지막으로 저장(또는 열기)한 내용. 시각은 빼고 비교한다. */
  #savedSignature: string | null = null;

  #signature(): string {
    return JSON.stringify({ ...scenario.serialize(), savedAt: 0 });
  }

  /** 지금 내용이 마지막 저장과 다른지 다시 계산한다. */
  check() {
    this.dirty = scenario.sections.length > 0 && this.#signature() !== this.#savedSignature;
  }

  /** 새 시나리오를 불러왔거나 닫았을 때: 아직 한 번도 저장하지 않은 상태 */
  forget() {
    this.#savedSignature = null;
    this.savedAt = null;
    this.size = null;
    this.status = "idle";
    this.check();
  }

  async refresh() {
    try {
      this.list = await invoke<SessionMeta[]>("list_sessions");
    } catch (e) {
      console.error(e);
    }
  }

  /** 지금 작업을 앱 안에 저장한다 (「저장」 버튼, ⌘/Ctrl+S, 닫을 때 확인 창). 저장 중에 또 불리면 끝난 뒤 한 번 더 저장한다. */
  async save(): Promise<void> {
    if (!scenario.sessionId || !scenario.sections.length) return;
    if (this.#saving) {
      this.#again = true;
      return this.#saving;
    }
    this.#saving = (async () => {
      do {
        this.#again = false;
        const id = scenario.sessionId;
        if (!id) break;
        const file = scenario.serialize();
        this.status = "saving";
        try {
          this.size = await invoke<number>("save_session", encoder.encode(JSON.stringify(file)), {
            headers: { "x-session-id": id, "x-session-meta": headerValue(JSON.stringify(meta(file))) },
          });
          this.savedAt = file.savedAt;
          this.#savedSignature = JSON.stringify({ ...file, savedAt: 0 });
          this.status = "saved";
          this.error = null;
          this.check();
        } catch (e) {
          this.status = "error";
          this.error = String(e);
        }
      } while (this.#again);
    })();
    try {
      await this.#saving;
    } finally {
      this.#saving = null;
    }
  }

  async open(id: string) {
    const json = await invoke<string>("load_session", { id });
    await scenario.restore(JSON.parse(json) as SaveFile, id);
    this.#savedSignature = this.#signature();
    this.savedAt = (JSON.parse(json) as SaveFile).savedAt;
    this.status = "saved";
    this.error = null;
    this.check();
  }

  async remove(id: string) {
    await invoke("delete_session", { id });
    await this.refresh();
  }

  /** 세이브 파일로 내보내기 (저장 창). 저장한 경로, 취소하면 null. */
  async exportFile(): Promise<string | null> {
    const file = scenario.serialize();
    return invoke<string | null>("export_session", encoder.encode(JSON.stringify(file)), {
      headers: { "x-file-name": headerValue(`${exportBaseName()}.${SAVE_EXTENSION}`) },
    });
  }

  /** 세이브 파일을 열어 새 작업으로 가져온다 (앱 안에도 바로 저장). */
  async importFile(file: File) {
    const json = await invoke<string>("decode_session", new Uint8Array(await file.arrayBuffer()));
    let parsed: SaveFile;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new Error("세이브 파일을 읽지 못했습니다");
    }
    await scenario.restore(parsed, newSessionId());
    await this.save();
  }
}

export const sessions = new Sessions();

/** 저장 안 된 변경이 있을 때 묻는다: "save" | "discard" | "cancel" */
export function askUnsaved(title: string, saveLabel: string) {
  return dialog.ask({
    title,
    message: `「${scenario.sourceName ?? "시나리오"}」에 저장하지 않은 변경이 있습니다.\n저장하지 않으면 마지막 저장 이후의 수정·확인·메모가 사라집니다.`,
    actions: [
      { id: "cancel", label: "취소" },
      { id: "discard", label: "저장하지 않음", variant: "danger" },
      { id: "save", label: saveLabel, variant: "primary" },
    ],
  });
}

export function isSaveFile(file: File) {
  return /\.(trpgsave|json)$/i.test(file.name);
}

export function formatSize(bytes: number | null | undefined): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function timeAgo(ms: number | null | undefined, now = Date.now()): string {
  if (!ms) return "";
  const sec = Math.round((now - ms) / 1000);
  if (sec < 45) return "방금";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const d = new Date(ms);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}
