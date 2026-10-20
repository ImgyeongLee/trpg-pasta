// 편집기의 줄 ↔ 블록(복사 카드) 연결.
//
// 한 줄이 블록 하나다. 글자를 고쳐도 그 줄의 블록(메모·화자·종류)은 유지되고,
// Enter로 새 줄이 생기면 새 블록, 줄을 합치면 아래 블록이 위 블록에 흡수된다.
// 줄마다 블록 id를 들고 있다가, 변경이 생기면 각 줄의 시작 위치를 옮겨(map) 다시 맞춘다.

import { Facet, StateEffect, StateField, type Transaction } from "@codemirror/state";

/** 그림 줄의 글자 (편집기에서는 그림 위젯으로 바뀌어 보인다) */
export const IMAGE_CHAR = "￼";

/** 그룹 줄의 글자 (편집기에서는 그룹 카드로 바뀌어 보인다) */
export const GROUP_CHAR = "\uE000";

/** 그림·그룹처럼 카드로 바뀌어 보이는 줄인지 */
export const isObjectLine = (text: string) => text === IMAGE_CHAR || text === GROUP_CHAR;

/** 새 줄의 블록 id를 정해 주는 함수. 방금 지운 같은 글자의 줄이면 그 id를 되살려 메모 등을 살린다. */
export const allocateId = Facet.define<(text: string) => number, (text: string) => number>({
  combine: (values) => values[0] ?? (() => -1),
});

/** 편집기 밖에서 줄 id를 통째로 정할 때 */
export const setLineIds = StateEffect.define<number[]>();

export const lineIds = StateField.define<number[]>({
  create: () => [],
  update(ids, tr) {
    for (const e of tr.effects) if (e.is(setLineIds)) return e.value;
    if (!tr.docChanged) return ids;
    const mapped = remapLineIds(ids, tr);
    // 같은 변경 안에서 사라졌다가 같은 글자로 다시 생긴 줄(줄 옮기기, 되돌리기)은 원래 id를 이어받는다.
    const kept = new Set(mapped);
    const vanished = new Map<string, number[]>();
    ids.forEach((id, i) => {
      if (kept.has(id) || i >= tr.startState.doc.lines) return;
      const text = tr.startState.doc.line(i + 1).text;
      vanished.set(text, [...(vanished.get(text) ?? []), id]);
    });
    const allocate = tr.state.facet(allocateId);
    return mapped.map((id, i) => {
      if (id >= 0) return id;
      const text = tr.state.doc.line(i + 1).text;
      return vanished.get(text)?.shift() ?? allocate(text);
    });
  },
});

/** 변경 전 i번째 줄(0부터)이 변경 후 어디서 시작하는지. Enter를 줄 맨 앞에서 누른 경우는 글자를 따라간다. */
function newLineStarts(tr: Transaction) {
  const pushed = new Map<number, number>();
  tr.changes.iterChanges((fromA, toA, _fromB, toB, inserted) => {
    if (fromA === toA && inserted.length && inserted.sliceString(inserted.length - 1) === "\n") pushed.set(fromA, toB);
  });
  const oldDoc = tr.startState.doc;
  return (i: number) => {
    const line = oldDoc.line(i + 1);
    const start = pushed.get(line.from) ?? tr.changes.mapPos(line.from, -1);
    // 줄 내용이 남아 있는지 (전부 지워졌으면 끝이 시작 자리로 접힌다)
    const survived = line.length > 0 && tr.changes.mapPos(line.to, 1) > start;
    return { start, survived, empty: line.length === 0 };
  };
}

/**
 * 변경 뒤 각 줄의 블록 id. 새로 생긴 줄은 -1.
 * 여러 옛 줄이 한 줄로 모이면(줄 삭제·합치기) 내용이 살아남은 줄 → 빈 줄이 아닌 줄 → 앞선 줄 순으로 이긴다.
 */
export function remapLineIds(ids: number[], tr: Transaction): number[] {
  const newDoc = tr.state.doc;
  const out: number[] = new Array(newDoc.lines).fill(-1);
  const rank: number[] = new Array(newDoc.lines).fill(-1);
  const at = newLineStarts(tr);
  for (let i = 0; i < ids.length && i < tr.startState.doc.lines; i++) {
    const { start, survived, empty } = at(i);
    const line = newDoc.lineAt(start);
    if (line.from !== start) continue; // 윗줄에 합쳐짐
    const score = (survived ? 2 : 0) + (empty ? 0 : 1);
    if (score > rank[line.number - 1]) {
      rank[line.number - 1] = score;
      out[line.number - 1] = ids[i];
    }
  }
  return out;
}

/**
 * 합쳐져서 사라진 줄 → 흡수한 줄의 id. (메모를 옮길 때 쓴다)
 * 내용 없이 통째로 지워진 줄은 들어가지 않는다.
 */
export function mergedInto(oldIds: number[], newIds: number[], tr: Transaction): Map<number, number> {
  const alive = new Set(newIds);
  const at = newLineStarts(tr);
  const merged = new Map<number, number>();
  for (let i = 0; i < oldIds.length; i++) {
    if (alive.has(oldIds[i])) continue;
    const { start, survived } = at(i);
    if (!survived) continue;
    const into = newIds[tr.state.doc.lineAt(start).number - 1];
    if (into !== undefined && into !== oldIds[i]) merged.set(oldIds[i], into);
  }
  return merged;
}
