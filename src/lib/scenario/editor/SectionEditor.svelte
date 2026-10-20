<script lang="ts">
  // 집합 하나를 일반 에디터처럼 고친다. 한 줄 = 복사 페이지의 카드 하나.
  import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
  import { EditorSelection, EditorState, type ChangeSpec } from "@codemirror/state";
  import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, type ViewUpdate } from "@codemirror/view";
  import { untrack } from "svelte";
  import { focusBlock } from "../focus";
  import { makeSentence, newBlockId, scenario } from "../state.svelte";
  import type { Block, Section } from "../types";
  import { editor, type EditorHandle } from "./api.svelte";
  import { editorTheme, lineDecorations, lineMeta, numberGutter, protectImages, refreshMeta, type LineMeta } from "./decorations";
  import { allocateId, GROUP_CHAR, IMAGE_CHAR, lineIds, mergedInto } from "./lines";

  /** 고칠 집합의 id. 집합은 store에서 찾아 직접 고친다 (prop으로 받은 객체를 고치지 않도록). */
  let { sectionId }: { sectionId: number } = $props();
  const section = $derived(scenario.sections.find((s) => s.id === sectionId) as Section);

  let host: HTMLDivElement;
  let view: EditorView | undefined;

  /** 편집기에 보이는 글자 (한 줄짜리여야 하므로 줄바꿈은 띄어쓰기로) */
  const editorText = (b: Block) => (b.type === "sentence" ? b.text.replace(/\n/g, " ") : b.type === "group" ? GROUP_CHAR : IMAGE_CHAR);

  // ── 지운 줄 보관: ⌘Z·잘라 붙이기로 같은 글자의 줄이 돌아오면 메모·화자를 되살린다 ──
  const grave = new Map<number, Block>();
  const graveByText = new Map<string, number[]>();

  function bury(block: Block) {
    grave.set(block.id, block);
    const key = editorText(block);
    graveByText.set(key, [...(graveByText.get(key) ?? []), block.id]);
  }

  function allocate(text: string): number {
    return graveByText.get(text)?.pop() ?? newBlockId();
  }

  let index = new Map<number, Block>();
  const reindex = () => (index = new Map(section.blocks.map((b) => [b.id, b])));

  function metaOf(id: number): LineMeta | undefined {
    const b = index.get(id) ?? grave.get(id);
    if (!b) return undefined;
    if (b.type === "image") return { kind: "image", warnings: [], image: b };
    if (b.type === "group") return { kind: "group", warnings: [], group: b };
    const sub = scenario.showPreview ? scenario.substituted[b.id] : undefined;
    return {
      kind: b.kind,
      note: b.note,
      speaker: b.speaker,
      warnings: b.warnings,
      preview: sub && sub !== b.text ? sub : undefined,
    };
  }

  // ── 편집기 → 블록 ──
  function syncBlocks(u: ViewUpdate) {
    const ids = u.state.field(lineIds);
    const doc = u.state.doc;
    const merges = new Map<number, number>();
    for (const tr of u.transactions) {
      if (tr.docChanged) for (const [from, into] of mergedInto(tr.startState.field(lineIds), tr.state.field(lineIds), tr)) merges.set(from, into);
    }
    const next: Block[] = [];
    let page: number | null = null;
    ids.forEach((id, i) => {
      const text = doc.line(i + 1).text;
      let block = index.get(id) ?? grave.get(id);
      grave.delete(id);
      if (!block) block = makeSentence(id, text, page);
      else if (block.type === "sentence" && block.text !== text) scenario.setText(block, text);
      page = block.page ?? page;
      next.push(block);
    });
    const alive = new Set(ids);
    const byId = new Map(next.map((b) => [b.id, b]));
    for (const block of section.blocks) {
      if (alive.has(block.id)) continue;
      // 윗줄에 합쳐진 줄: 메모를 옮긴다.
      const into = byId.get(merges.get(block.id) ?? -1);
      if (into && block.note) into.note = into.note ? `${into.note}\n${block.note}` : block.note;
      bury(block);
    }
    section.blocks = next;
    reindex();
  }

  function updateSelection(state: EditorState) {
    const ids = state.field(lineIds);
    const { from, to, head } = state.selection.main;
    const a = state.doc.lineAt(from).number;
    const b = state.doc.lineAt(to).number;
    editor.selection = ids.slice(a - 1, b);
    const current = ids[state.doc.lineAt(head).number - 1];
    if (current !== undefined && scenario.focusedId !== current) scenario.focusedId = current;
  }

  function onUpdate(u: ViewUpdate) {
    if (u.docChanged) syncBlocks(u);
    if (u.selectionSet || u.docChanged) updateSelection(u.state);
  }

  // ── 명령 ──
  /** ⌘/Ctrl+Enter: 다음 줄로 (줄을 나누지 않고) */
  function nextLine(v: EditorView) {
    const line = v.state.doc.lineAt(v.state.selection.main.head);
    if (line.number < v.state.doc.lines) v.dispatch({ selection: { anchor: v.state.doc.line(line.number + 1).to }, scrollIntoView: true });
    return true;
  }

  /** Enter: 줄을 나눈다. 나눈 자리 양쪽의 띄어쓰기는 지워 새 카드가 공백으로 시작하지 않게 한다. */
  function splitLine(v: EditorView) {
    const changes = v.state.changeByRange((range) => {
      const line = v.state.doc.lineAt(range.from);
      let from = range.from;
      let to = range.to;
      while (from > line.from && /\s/.test(v.state.doc.sliceString(from - 1, from))) from--;
      while (to < line.to && /\s/.test(v.state.doc.sliceString(to, to + 1))) to++;
      return { changes: { from, to, insert: "\n" }, range: EditorSelection.cursor(from + 1) };
    });
    v.dispatch(changes, { scrollIntoView: true, userEvent: "input" });
    return true;
  }

  /** ⌘⇧G: 커서가 걸친 줄들을 그룹 하나로 묶기 */
  function groupHere() {
    const id = scenario.makeGroup(editor.selection);
    if (id !== null) focusBlock(id);
    return true;
  }

  /** ⌘⇧M: 이 줄에 GM 메모 쓰기 */
  function requestNote() {
    editor.noteRequest++;
    return true;
  }

  function createState(blocks: Block[]) {
    return EditorState.create({
      doc: blocks.map(editorText).join("\n"),
      extensions: [
        lineIds.init(() => blocks.map((b) => b.id)),
        allocateId.of(allocate),
        lineMeta.of(metaOf),
        lineDecorations,
        numberGutter,
        protectImages,
        history(),
        drawSelection(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        EditorView.lineWrapping,
        keymap.of([
          { key: "Mod-Enter", run: nextLine },
          { key: "Mod-Shift-g", run: groupHere },
          { key: "Mod-Shift-m", run: requestNote },
          { key: "Enter", run: splitLine },
          ...historyKeymap,
          ...defaultKeymap,
        ]),
        editorTheme,
        EditorView.updateListener.of(onUpdate),
        EditorView.contentAttributes.of({ "aria-label": "시나리오 문장 — 한 줄이 복사 카드 하나", spellcheck: "false" }),
      ],
    });
  }

  const handle: EditorHandle = {
    focus(id, caret) {
      if (!view) return false;
      const i = view.state.field(lineIds).indexOf(id);
      if (i < 0) return false;
      const line = view.state.doc.line(i + 1);
      const pos = caret === undefined || caret < 0 ? line.to : line.from + Math.min(caret, line.length);
      view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
      view.focus();
      return true;
    },
    jumpNext(match) {
      if (!view) return false;
      const ids = view.state.field(lineIds);
      const here = view.state.doc.lineAt(view.state.selection.main.head).number - 1;
      for (let k = 1; k <= ids.length; k++) {
        const i = (here + k) % ids.length;
        if (match(ids[i])) return handle.focus(ids[i], 0);
      }
      return false;
    },
    deleteLines(targets) {
      if (!view) return;
      const doc = view.state.doc;
      const ids = view.state.field(lineIds);
      const wanted = new Set(targets);
      const changes: ChangeSpec[] = [];
      for (let i = 0; i < ids.length; i++) {
        if (!wanted.has(ids[i])) continue;
        const line = doc.line(i + 1);
        // 줄바꿈까지 지워 줄이 통째로 사라지게 한다 (마지막 줄이면 앞 줄바꿈)
        if (line.number < doc.lines) changes.push({ from: line.from, to: line.to + 1 });
        else if (line.number > 1) changes.push({ from: line.from - 1, to: line.to });
        else changes.push({ from: line.from, to: line.to });
      }
      view.dispatch({ changes, userEvent: "delete" });
      view.focus();
    },
    selectAll() {
      if (!view) return;
      view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
      view.focus();
    },
  };

  // 편집기 만들기 (집합마다 한 번). 안에서 읽는 상태가 바뀌어도 다시 만들지 않도록 전부 untrack 한다.
  $effect(() => {
    untrack(() => {
      view = new EditorView({ state: createState(section.blocks), parent: host });
      reindex();
      editor.handle = handle;
      const pending = editor.pending;
      if (pending && index.has(pending.id)) {
        editor.pending = null;
        handle.focus(pending.id, pending.caret);
      }
      updateSelection(view.state);
    });
    return () => {
      view?.destroy();
      view = undefined;
      if (editor.handle === handle) editor.handle = null;
    };
  });

  // 블록이 편집기 밖에서 바뀌면(집합 나누기·합치기·되돌리기·세이브 열기 …) 편집기를 다시 맞춘다.
  $effect(() => {
    const signature = section.blocks.map((b) => `${b.id}\u0001${editorText(b)}`).join("\u0002");
    untrack(() => {
      if (!view) return;
      const ids = view.state.field(lineIds);
      const mine = ids.map((id, i) => `${id}\u0001${view!.state.doc.line(i + 1).text}`).join("\u0002");
      if (mine === signature) return;
      const lineNo = view.state.doc.lineAt(view.state.selection.main.head).number;
      reindex();
      view.setState(createState(section.blocks));
      const line = view.state.doc.line(Math.min(lineNo, view.state.doc.lines));
      view.dispatch({ selection: { anchor: line.from } });
      updateSelection(view.state);
    });
  });

  // 줄 정보(종류·메모·화자·경고·치환 미리보기)가 바뀌면 다시 그린다.
  $effect(() => {
    for (const b of section.blocks) {
      void b.note;
      if (b.type === "sentence") {
        void b.kind;
        void b.speaker;
        void b.warnings.length;
      }
    }
    void scenario.showPreview;
    void scenario.substituted;
    untrack(() => {
      reindex();
      view?.dispatch({ effects: refreshMeta.of(null) });
    });
  });
</script>

<div class="editor" bind:this={host}></div>

<style>
  .editor {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .editor :global(.cm-editor) {
    flex: 1;
    min-height: 0;
  }
</style>
