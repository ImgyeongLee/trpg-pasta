// 편집기 밖(툴바, 원본 보기, 필터 칩)에서 지금 열린 편집기에 접근하는 창구.

export interface EditorHandle {
  /** 줄로 이동해 커서를 둔다. 그 줄이 이 편집기에 없으면 false */
  focus: (id: number, caret?: number) => boolean;
  /** 커서 다음 줄부터 조건에 맞는 줄로 이동 (끝까지 가면 처음부터) */
  jumpNext: (match: (id: number) => boolean) => boolean;
  /** 줄들을 지운다 (⌘Z로 되돌릴 수 있게 편집기 변경으로) */
  deleteLines: (ids: number[]) => void;
  selectAll: () => void;
}

class EditorApi {
  /** 커서·선택이 걸친 줄들의 블록 id (한 줄이면 커서가 있는 줄) */
  selection = $state<number[]>([]);
  handle: EditorHandle | null = null;
  /** ⌘⇧M: 「현재 줄」 막대의 메모 칸을 열라는 신호 (늘어날 때마다 연다) */
  noteRequest = $state(0);
  /** 집합을 옮긴 직후처럼 편집기가 아직 없을 때 보낸 이동 요청 — 편집기가 뜨면서 처리한다 */
  pending: { id: number; caret?: number } | null = null;

  focus(id: number, caret?: number) {
    if (this.handle?.focus(id, caret)) return;
    this.pending = { id, caret };
  }
}

export const editor = new EditorApi();
