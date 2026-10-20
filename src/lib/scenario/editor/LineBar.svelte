<script lang="ts">
  // 「현재 줄」 막대: 커서가 있는 줄의 종류·화자·메모를 바꾼다. 여러 줄을 고르면 한꺼번에 처리.
  import {
    BookKey,
    Group,
    Heading,
    MessageSquareQuote,
    Pilcrow,
    SquareSplitVertical,
    StickyNote,
    Trash,
    Ungroup,
  } from "$lib/icons";
  import Select from "$lib/ui/Select.svelte";
  import type { SelectOption } from "$lib/ui/select";
  import { focusBlock } from "../focus";
  import NoteEditor from "../NoteEditor.svelte";
  import SpeakerTag from "../SpeakerTag.svelte";
  import { GM_TAG } from "../tags.svelte";
  import TagPicker from "../TagPicker.svelte";
  import { scenario } from "../state.svelte";
  import type { SentenceKind } from "../types";
  import { editor } from "./api.svelte";

  const kindOptions: SelectOption<SentenceKind>[] = [
    { value: "narration", label: "서술", icon: Pilcrow },
    { value: "dialogue", label: "대사", icon: MessageSquareQuote },
    { value: "heading", label: "제목·항목", icon: Heading },
  ];

  const blocks = $derived(scenario.active?.blocks ?? []);
  const chosen = $derived(editor.selection.map((id) => blocks.find((b) => b.id === id)).filter((b) => b !== undefined));
  const block = $derived(chosen.length === 1 ? chosen[0] : undefined);
  const lineNo = $derived(block ? blocks.indexOf(block) + 1 : 0);

  /** 메모 칸: 쓸 때만 연다 (써 둔 메모는 편집기의 줄 아래에 보인다). Enter로 저장하고 닫는다. */
  let noteOpen = $state(false);
  let noteFocus = $state(false);
  const showNote = $derived(!!block && noteOpen);

  // 줄을 옮기면 메모 칸은 그 줄에 메모가 있을 때만 남긴다.
  $effect(() => {
    void block?.id;
    noteOpen = false;
    noteFocus = false;
  });

  // ⌘⇧M
  let seen = editor.noteRequest;
  $effect(() => {
    if (editor.noteRequest === seen) return;
    seen = editor.noteRequest;
    if (block) {
      noteOpen = true;
      noteFocus = true;
    }
  });

  /** 고른 줄을 그룹 카드 하나로 */
  /** tag를 주면 그 태그(예: GM 정보)를 붙여서 묶는다 */
  function makeGroup(tag?: string) {
    const id = scenario.makeGroup(editor.selection, tag);
    if (id !== null) focusBlock(id);
  }

  function closeNote(target: NonNullable<typeof block>, refocus: boolean) {
    if (!target.note?.trim()) scenario.setNote(target, undefined);
    noteOpen = noteFocus = false;
    if (refocus) focusBlock(target.id);
  }

  const groupLabel = $derived(block?.type === "group" ? scenario.groupLabels.get(block.id) : undefined);

</script>

<div class="bar">
  {#if chosen.length > 1}
    <span class="label">{chosen.length}줄 선택</span>
    <button class="btn sm group" onclick={() => makeGroup()} title="고른 줄을 카드 하나로 묶기 (줄바꿈이 있어도 한 번에 복사, 태그를 붙일 수 있음) ⌘⇧G">
      <Group size={14} /> 그룹으로 묶기
    </button>
    <button class="btn sm gm" onclick={() => makeGroup(GM_TAG)} title="고른 줄을 「GM 정보」 태그 그룹으로 묶기 (복사·내보내기에서 빠짐)">
      <BookKey size={14} /> GM 정보로 묶기
    </button>
    <button class="btn sm danger" onclick={() => editor.handle?.deleteLines(editor.selection)} title="Delete (⌘Z로 되돌리기)">
      <Trash size={14} /> 삭제
    </button>
  {:else if block}
    <span class="label">{lineNo}번째 줄{block.page ? ` · ${block.page}쪽` : ""}{groupLabel ? ` · ${groupLabel}` : ""}</span>
    {#if block.type === "sentence"}
      <Select label="종류" size="sm" options={kindOptions} value={block.kind} onchange={(kind) => scenario.setKind(block, kind)} />
      <SpeakerTag {block} />
      <button class="btn sm group" onclick={() => makeGroup()} title="이 줄을 그룹 카드로 (여러 줄을 고르면 한 카드로 묶임) ⌘⇧G">
        <Group size={14} /> 그룹으로 묶기
      </button>
      <button class="btn sm gm" onclick={() => makeGroup(GM_TAG)} title="이 줄을 「GM 정보」 태그 그룹으로 (복사·내보내기에서 빠짐)">
        <BookKey size={14} /> GM 정보로 묶기
      </button>
    {/if}
    <button
      class="btn sm"
      class:on={showNote || !!block.note}
      onclick={() => {
        noteOpen = true;
        noteFocus = true;
      }}
      title="GM 메모 — 복사되지 않음 (⌘⇧M)"
    >
      <StickyNote size={14} /> 메모
    </button>
    {#if lineNo > 1}
      <button class="btn sm" onclick={() => scenario.splitSectionAt(block.id)} title="이 줄부터 새 집합으로 나누기">
        <SquareSplitVertical size={14} /> 여기서 새 집합
      </button>
    {/if}
    {#if block.type === "group"}
      <TagPicker value={block.tag} onchange={(tag) => scenario.setGroupTag(block, tag)} />
      <button
        class="btn sm"
        onclick={() => {
          const id = scenario.unwrapGroup(block);
          if (id !== null) focusBlock(id);
        }}
        title="그룹을 풀어 다시 한 줄씩 카드로"
      >
        <Ungroup size={14} /> 줄로 풀기
      </button>
      <button class="btn sm danger" onclick={() => editor.handle?.deleteLines([block.id])} title="그룹 지우기 (⌘Z로 되돌리기)">
        <Trash size={14} /> 그룹 지우기
      </button>
    {/if}
    {#if block.type === "image"}
      <button class="btn sm danger" onclick={() => editor.handle?.deleteLines([block.id])} title="그림 줄 지우기 (⌘Z로 되돌리기)">
        <Trash size={14} /> 그림 지우기
      </button>
    {/if}
  {:else}
    <span class="label muted">줄을 누르면 여기에서 종류·화자·메모를 바꿀 수 있어요</span>
  {/if}
</div>
{#if block && showNote}
  <div class="note">
    <NoteEditor
      value={block.note ?? ""}
      autofocus={noteFocus}
      onchange={(v) => scenario.setNote(block, v)}
      ondone={(refocus) => closeNote(block, refocus)}
    />
  </div>
{/if}

<style>
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    min-height: 42px;
    padding: 6px 16px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }

  .label {
    margin-right: 4px;
    color: var(--text-muted);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  .btn.on {
    border-color: var(--ok);
    color: var(--ok);
  }

  .btn.gm {
    border-color: var(--gm);
    color: var(--gm);
  }

  .btn.gm:hover {
    background: var(--gm-soft);
  }

  .btn.group {
    border-color: var(--accent);
    color: var(--accent);
  }

  .btn.group:hover {
    background: var(--accent-soft);
  }

  .btn.danger {
    color: var(--danger);
  }

  .btn.danger:hover {
    border-color: var(--danger);
    background: var(--danger-soft);
  }

  .note {
    padding: 0 16px 8px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }
</style>
