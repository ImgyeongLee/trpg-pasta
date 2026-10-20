// 편집기 꾸미기: 줄 종류(제목) 굵기, 줄 아래 GM 메모·치환 미리보기, 줄 끝 화자, 그림, 그룹 카드, 왼쪽 줄 번호.
// 줄의 정보(블록)는 편집기 밖(Svelte 상태)에 있으므로 `lineMeta`로 읽어 오고, 바뀌면 `refreshMeta`로 다시 그린다.

import { EditorState, Facet, StateEffect, StateField, type Extension, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, GutterMarker, WidgetType, gutter } from "@codemirror/view";
import { mount, unmount } from "svelte";
import ImageView from "../ImageView.svelte";
import type { GroupBlock, ImageBlock, SentenceKind, Warning } from "../types";
import GroupCard from "./GroupCard.svelte";
import { stickyNote, triangleAlert, userRound } from "./icons";
import { isObjectLine, lineIds, setLineIds } from "./lines";

export interface LineMeta {
  kind: SentenceKind | "image" | "group";
  note?: string;
  speaker?: string;
  warnings: Warning[];
  /** 이름 치환 결과 (원문과 다를 때만) */
  preview?: string;
  image?: ImageBlock;
  group?: GroupBlock;
}

/** 블록 id → 줄 정보. 편집기 밖의 상태를 읽는다. */
export const lineMeta = Facet.define<(id: number) => LineMeta | undefined, (id: number) => LineMeta | undefined>({
  combine: (values) => values[0] ?? (() => undefined),
});

/** 편집기 밖에서 줄 정보가 바뀌었으니 다시 그리라는 신호 */
export const refreshMeta = StateEffect.define<null>();

const WARNING_TEXT: Record<Warning, string> = {
  unbalancedQuote: "따옴표/괄호 짝이 맞지 않음",
  noTerminator: "문장 부호 없이 끝남",
  tooLong: "문장이 매우 김 (덜 나뉘었을 수 있음)",
};

const KIND_TAG: Partial<Record<SentenceKind, string>> = { dialogue: "대사", heading: "제목·항목" };

/** 줄 끝 태그: 종류(대사·제목) + 경고. 복사되지 않는다. */
class TagsWidget extends WidgetType {
  constructor(
    readonly kind: SentenceKind,
    readonly warnings: Warning[],
  ) {
    super();
  }
  eq(other: TagsWidget) {
    return other.kind === this.kind && other.warnings.join() === this.warnings.join();
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-tags";
    const label = KIND_TAG[this.kind];
    if (label) {
      const tag = document.createElement("span");
      tag.className = `cm-tag cm-tag-${this.kind}`;
      tag.textContent = label;
      el.append(tag);
    }
    for (const w of this.warnings) {
      const tag = document.createElement("span");
      tag.className = "cm-tag cm-tag-warn";
      tag.innerHTML = triangleAlert(10);
      tag.append(WARNING_TEXT[w]);
      el.append(tag);
    }
    return el;
  }
}

class SpeakerWidget extends WidgetType {
  constructor(readonly name: string) {
    super();
  }
  eq(other: SpeakerWidget) {
    return other.name === this.name;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-speaker";
    el.title = "화자 (복사되지 않음)";
    el.innerHTML = userRound();
    el.append(this.name);
    return el;
  }
}

class BelowWidget extends WidgetType {
  constructor(
    readonly kind: "note" | "preview",
    readonly text: string,
  ) {
    super();
  }
  eq(other: BelowWidget) {
    return other.kind === this.kind && other.text === this.text;
  }
  toDOM() {
    const el = document.createElement("div");
    el.className = `cm-${this.kind}`;
    if (this.kind === "note") {
      el.title = "GM 메모 (복사되지 않음)";
      el.innerHTML = stickyNote();
    }
    const span = document.createElement("span");
    span.textContent = this.text;
    el.append(span);
    return el;
  }
}

/** 그림 위젯 DOM → 거기에 띄운 Svelte 컴포넌트 (위젯을 치울 때 함께 정리) */
const mounted = new WeakMap<HTMLElement, ReturnType<typeof mount>>();

/** 그림 줄: 기존 그림 보기 컴포넌트(확대·저장 버튼 포함)를 그대로 띄운다. */
class ImageWidget extends WidgetType {
  constructor(readonly block: ImageBlock) {
    super();
  }
  eq(other: ImageWidget) {
    return other.block.id === this.block.id;
  }
  toDOM(view: EditorView) {
    const el = document.createElement("div");
    el.className = "cm-image";
    mounted.set(el, mount(ImageView, { target: el, props: { block: this.block } }));
    // 그림을 누르면 그 줄을 고른다 (화살표로는 그림을 건너뛰므로). 확대·저장 버튼은 그대로 둔다.
    el.addEventListener("mousedown", (e) => {
      if ((e.target as Element).closest("button")) return;
      e.preventDefault();
      view.dispatch({ selection: { anchor: view.posAtDOM(el) } });
      view.focus();
    });
    return el;
  }
  destroy(dom: HTMLElement) {
    const instance = mounted.get(dom);
    if (instance) unmount(instance);
    mounted.delete(dom);
  }
  ignoreEvent() {
    return true; // 그림 위 버튼(확대·저장)을 편집기가 가로채지 않게
  }
}

/** 그룹 줄: 편집할 수 있는 카드. 카드 안의 Enter는 줄바꿈일 뿐 새 줄(카드)을 만들지 않는다. */
class GroupWidget extends WidgetType {
  constructor(readonly block: GroupBlock) {
    super();
  }
  eq(other: GroupWidget) {
    return other.block.id === this.block.id;
  }
  toDOM(view: EditorView) {
    const el = document.createElement("div");
    el.className = "cm-group";
    // 카드 안을 누르거나 글자 칸에 들어가면 그 줄을 고른다 (「현재 줄」 막대가 이 그룹을 가리키게).
    const select = () => {
      const pos = view.posAtDOM(el);
      if (view.state.selection.main.head !== pos) view.dispatch({ selection: { anchor: pos } });
    };
    mounted.set(el, mount(GroupCard, { target: el, props: { block: this.block, onselect: select } }));
    el.addEventListener("mousedown", (e) => {
      if ((e.target as Element).closest("button, input, textarea, [role=listbox], [role=dialog]")) return;
      e.preventDefault();
      select();
      view.focus();
    });
    return el;
  }
  destroy(dom: HTMLElement) {
    const instance = mounted.get(dom);
    if (instance) unmount(instance);
    mounted.delete(dom);
  }
  ignoreEvent() {
    return true; // 카드 안의 입력칸·버튼은 편집기가 가로채지 않게
  }
}

function build(state: EditorState): DecorationSet {
  const ids = state.field(lineIds);
  const meta = state.facet(lineMeta);
  const ranges: Range<Decoration>[] = [];
  for (let i = 0; i < ids.length && i < state.doc.lines; i++) {
    const line = state.doc.line(i + 1);
    const m = meta(ids[i]);
    if (!m) continue;
    if (m.kind === "image") {
      if (m.image) ranges.push(Decoration.replace({ widget: new ImageWidget(m.image), block: true }).range(line.from, line.to));
      continue;
    }
    if (m.kind === "group") {
      if (m.group) ranges.push(Decoration.replace({ widget: new GroupWidget(m.group), block: true }).range(line.from, line.to));
      continue;
    }
    ranges.push(Decoration.line({ class: `cm-k-${m.kind}` }).range(line.from));
    if (KIND_TAG[m.kind] || m.warnings.length) {
      ranges.push(Decoration.widget({ widget: new TagsWidget(m.kind, m.warnings), side: 0 }).range(line.to));
    }
    if (m.speaker) ranges.push(Decoration.widget({ widget: new SpeakerWidget(m.speaker), side: 1 }).range(line.to));
    if (m.preview) ranges.push(Decoration.widget({ widget: new BelowWidget("preview", m.preview), side: 2, block: true }).range(line.to));
    if (m.note) ranges.push(Decoration.widget({ widget: new BelowWidget("note", m.note), side: 3, block: true }).range(line.to));
  }
  return Decoration.set(ranges, true);
}

/** 줄 꾸미기. 그림처럼 줄 높이를 바꾸는 장식이 있어 StateField로 둔다. */
export const lineDecorations = StateField.define<DecorationSet>({
  create: build,
  update(deco, tr) {
    if (tr.docChanged || tr.effects.some((e) => e.is(refreshMeta) || e.is(setLineIds))) return build(tr.state);
    return deco;
  },
  provide: (field) => [EditorView.decorations.from(field), EditorView.atomicRanges.of((view) => view.state.field(field))],
});

class NumberMarker extends GutterMarker {
  constructor(readonly n: number) {
    super();
  }
  eq(other: NumberMarker) {
    return other.n === this.n;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-num";
    el.textContent = String(this.n);
    return el;
  }
}

/** 왼쪽 여백: 카드 번호 */
export const numberGutter: Extension = gutter({
  class: "cm-num-gutter",
  lineMarker: (view, block) => new NumberMarker(view.state.doc.lineAt(block.from).number),
  lineMarkerChange: (update) => update.docChanged,
  initialSpacer: () => new NumberMarker(999),
});

/**
 * 그림·그룹 줄 보호: 그 줄 안에 글자를 넣거나, 앞뒤 줄을 그 줄에 합치는 변경은 막는다.
 * 줄을 통째로 지우거나, 그 줄 앞·뒤에서 Enter로 새 줄을 만드는 것은 된다.
 */
export const protectImages = EditorState.changeFilter.of((tr) => {
  if (!tr.docChanged) return true;
  const doc = tr.startState.doc;
  const images: [number, number][] = [];
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    if (isObjectLine(line.text)) images.push([line.from, line.to]);
  }
  if (!images.length) return true;
  let ok = true;
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    for (const [f, t] of images) {
      const wholeLine = fromA <= f && toA >= t && (toA > t || fromA < f); // 그림 줄과 이웃 줄바꿈까지 지움
      if (wholeLine) continue;
      const text = inserted.toString();
      if (fromA === toA) {
        // 그림 앞에서 Enter(새 줄 위로), 그림 뒤에서 Enter(새 줄 아래로)만 허용
        if (fromA === f && text.endsWith("\n")) continue;
        if (fromA === t && text.startsWith("\n")) continue;
        if (fromA >= f && fromA <= t) ok = false;
      } else if (fromA < t + 1 && toA > f - 1) {
        ok = false; // 그림 줄 일부나 이웃 줄바꿈만 지우는 변경
      }
    }
  });
  return ok;
});

export const editorTheme = EditorView.theme({
  "&": { height: "100%", fontSize: "15px", backgroundColor: "transparent" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font)", lineHeight: "1.6", overflow: "auto" },
  ".cm-content": { padding: "10px 0 60px", caretColor: "var(--accent)" },
  // 커서: 어두운 화면에서도 보이도록 굵은 초록 막대
  ".cm-cursor, .cm-dropCursor": { borderLeft: "2px solid var(--accent)", marginLeft: "-1px" },
  ".cm-line": { padding: "3px 16px 3px 10px", borderLeft: "3px solid transparent" },
  // 지금 고치는 줄: 왼쪽 초록 띠 + 옅은 초록 바탕 + 줄 번호 강조
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--accent) 12%, transparent)", borderLeftColor: "var(--accent)" },
  ".cm-k-heading": { fontWeight: "700" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in srgb, var(--accent) 22%, transparent) !important",
  },
  ".cm-gutters": { backgroundColor: "transparent", border: "none", color: "var(--text-faint)" },
  ".cm-num-gutter .cm-gutterElement": { padding: "5px 6px 0 12px", textAlign: "right" },
  ".cm-num": { fontSize: "11px", fontVariantNumeric: "tabular-nums" },
  ".cm-num-gutter .cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--accent)", fontWeight: "700" },
  ".cm-tags": { display: "inline-flex", gap: "4px", marginLeft: "8px", verticalAlign: "1px" },
  ".cm-tag": {
    display: "inline-flex",
    alignItems: "center",
    gap: "3px",
    height: "19px",
    padding: "0 7px",
    borderRadius: "999px",
    fontSize: "11px",
    fontWeight: "600",
    whiteSpace: "nowrap",
    userSelect: "none",
  },
  ".cm-tag-dialogue": { backgroundColor: "var(--dialogue-soft)", color: "var(--dialogue)" },
  ".cm-tag-heading": { backgroundColor: "var(--surface-3)", color: "var(--text-muted)" },
  ".cm-tag-warn": { backgroundColor: "var(--warn-soft)", color: "var(--warn)" },
  ".cm-speaker": {
    display: "inline-flex",
    alignItems: "center",
    gap: "3px",
    marginLeft: "8px",
    padding: "0 7px",
    height: "19px",
    borderRadius: "999px",
    backgroundColor: "var(--accent-soft)",
    color: "var(--accent)",
    fontSize: "11px",
    fontWeight: "600",
    verticalAlign: "1px",
  },
  ".cm-note": {
    display: "flex",
    gap: "6px",
    alignItems: "baseline",
    margin: "0 16px 4px 13px",
    padding: "3px 8px",
    borderLeft: "3px solid var(--note)",
    borderRadius: "0 6px 6px 0",
    backgroundColor: "var(--note-soft)",
    color: "var(--note)",
    fontSize: "13px",
    whiteSpace: "pre-wrap",
  },
  ".cm-note span": { color: "var(--text)", opacity: "0.85" },
  ".cm-preview": { margin: "-2px 16px 4px 16px", color: "var(--accent)", fontSize: "13px" },
  ".cm-image": { padding: "6px 16px 6px 13px" },
  ".cm-group": { padding: "6px 16px 6px 13px" },
});
