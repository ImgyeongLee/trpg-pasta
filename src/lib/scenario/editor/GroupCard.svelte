<script lang="ts">
  // 편집기 안의 그룹 카드. 줄바꿈(Enter)은 카드 안의 줄바꿈일 뿐이고, 카드를 나누려면 「나누기」(⌘/Ctrl+Enter)를 누른다.
  // 태그(핸드아웃·성공 판정·실패 판정·만든 태그)를 붙이면 그 색으로 칠해지고, 복사 페이지의 매크로 아래에 모인다.
  import { tick } from "svelte";
  import { Group, Scissors, StickyNote, Ungroup } from "$lib/icons";
  import { autosize } from "$lib/ui/autosize";
  import { focusBlock } from "../focus";
  import { scenario } from "../state.svelte";
  import { isSecret, tags } from "../tags.svelte";
  import TagPicker from "../TagPicker.svelte";
  import type { GroupBlock } from "../types";

  let { block, onselect }: { block: GroupBlock; onselect: () => void } = $props();

  let textarea = $state<HTMLTextAreaElement>();
  /** 나눌 자리 (글자 칸의 커서 위치) */
  let caret = $state(-1);
  const color = $derived(tags.get(block.tag)?.color);
  const canSplit = $derived(caret > 0 && caret < block.text.length && !!block.text.slice(0, caret).trim() && !!block.text.slice(caret).trim());

  const track = () => (caret = textarea?.selectionStart ?? -1);

  async function split() {
    if (!canSplit) return;
    const id = scenario.splitGroup(block, caret);
    if (id === null) return;
    caret = -1;
    await tick();
    focusBlock(id, 0);
  }

  function unwrap() {
    const id = scenario.unwrapGroup(block);
    if (id !== null) focusBlock(id);
  }
</script>

<div class="group" class:tagged={!!color} style:--tag={color}>
  <header>
    <span class="label">
      <Group size={13} /> {scenario.groupLabels.get(block.id) ?? "그룹"}
      {#if isSecret(block)}<span class="secret">복사 안 됨</span>{/if}
    </span>
    <TagPicker value={block.tag} onchange={(tag) => scenario.setGroupTag(block, tag)} />
    <input
      class="title"
      value={block.title ?? ""}
      placeholder="제목 (복사되지 않음)"
      aria-label="그룹 제목"
      spellcheck="false"
      onfocus={onselect}
      oninput={(e) => scenario.setGroupTitle(block, e.currentTarget.value)}
      onkeydown={(e) => {
        if (e.isComposing || e.keyCode === 229) return;
        if (e.key === "Enter" || e.key === "Escape") {
          e.preventDefault();
          textarea?.focus();
        }
      }}
    />
    <button
      class="btn sm"
      onmousedown={(e) => e.preventDefault()}
      onclick={split}
      disabled={!canSplit}
      title={canSplit ? "커서 위치에서 두 카드로 나누기 (⌘/Ctrl+Enter)" : "아래 글에서 나눌 곳을 누른 다음 누르세요"}
    >
      <Scissors size={13} /> 나누기
    </button>
    <button class="btn sm" onclick={unwrap} title="그룹을 풀어 다시 한 줄씩 카드로">
      <Ungroup size={13} /> 줄로 풀기
    </button>
  </header>
  <textarea
    bind:this={textarea}
    use:autosize={block.text}
    rows="1"
    spellcheck="false"
    aria-label="그룹 내용"
    value={block.text}
    onfocus={() => {
      onselect();
      track();
    }}
    oninput={(e) => {
      scenario.setGroupText(block, e.currentTarget.value);
      track();
    }}
    onkeyup={track}
    onmouseup={track}
    onkeydown={(e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        track();
        split();
      }
    }}
  ></textarea>
  {#if block.note}
    <div class="note" title="GM 메모 (복사되지 않음)"><StickyNote size={12} /><span>{block.note}</span></div>
  {/if}
</div>

<style>
  /* --tag(태그 색)가 있으면 그 색으로, 없으면 회색으로 칠한다. 바탕은 테마 바탕에 섞어 어두운 화면에서도 읽힌다. */
  .group {
    border: 1px solid var(--border-strong);
    border-left: 3px solid var(--text-faint);
    border-radius: 0 var(--radius) var(--radius) 0;
    background: var(--surface-2);
    font-family: var(--font);
    /* 편집기(pre-wrap) 안이라 요소 사이 띄어쓰기가 빈 줄로 보이지 않게 */
    white-space: normal;
  }

  .group.tagged {
    border-color: color-mix(in srgb, var(--tag) 40%, var(--border));
    border-left-color: var(--tag);
    background: color-mix(in srgb, var(--tag) 16%, var(--surface));
  }

  header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px 0 10px;
  }

  .label {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 4px;
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 700;
    user-select: none;
    -webkit-user-select: none;
  }

  .tagged .label {
    color: color-mix(in srgb, var(--tag) 60%, var(--text));
  }

  .secret {
    margin-left: 2px;
    color: var(--text-faint);
    font-weight: 500;
  }

  .title {
    flex: 1;
    min-width: 0;
    padding: 2px 6px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 13px;
    font-weight: 600;
  }

  .title:hover {
    border-color: var(--border);
  }

  .title:focus {
    border-color: var(--accent);
    outline: none;
  }

  .title::placeholder {
    color: var(--text-faint);
    font-weight: 400;
  }

  textarea {
    display: block;
    width: 100%;
    padding: 6px 12px 10px;
    border: 0;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 15px;
    line-height: 1.6;
    resize: none;
    overflow: hidden;
    caret-color: var(--accent);
  }

  textarea:focus {
    outline: none;
  }

  .group:focus-within {
    border-color: var(--accent);
  }

  .note {
    display: flex;
    gap: 6px;
    align-items: baseline;
    margin: 0 10px 8px;
    padding: 3px 8px;
    border-left: 3px solid var(--note);
    border-radius: 0 6px 6px 0;
    background: var(--note-soft);
    color: var(--note);
    font-size: 13px;
    white-space: pre-wrap;
  }

  .note span {
    color: var(--text);
    opacity: 0.85;
  }
</style>
