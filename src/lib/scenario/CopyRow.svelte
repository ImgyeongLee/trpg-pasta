<script lang="ts">
  // 복사 페이지의 시나리오 카드. 카드 자체를 누르면 복사된다 (GM 메모는 참고용으로만 보이고 복사되지 않는다).
  import { copyImage, copyText } from "$lib/clipboard";
  import { BookKey, Check, Copy, Group, StickyNote, TriangleAlert, UserRound } from "$lib/icons";
  import { layout } from "$lib/layout.svelte";
  import ImageView from "./ImageView.svelte";
  import { unquote } from "./quotes";
  import { scenario } from "./state.svelte";
  import { isSecret, tags } from "./tags.svelte";
  import type { Block } from "./types";

  let {
    block,
    index,
    selected,
    onselect,
    oncopied,
  }: { block: Block; index: number; selected: boolean; onselect: () => void; oncopied: () => void } = $props();

  let flash = $state(false);
  let failed = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const text = $derived(block.type === "image" ? "" : scenario.finalText(block));
  /** 클립보드에 넣을 글: 「따옴표 빼고 복사」가 켜져 있으면 대사의 바깥 따옴표를 뗀다 (카드에는 그대로 보인다) */
  const copiedText = $derived(layout.copyUnquote && block.type === "sentence" && block.kind === "dialogue" ? unquote(text) : text);
  /** GM 정보 그룹: 보이기만 하고 복사하지 않는다 */
  const gm = $derived(isSecret(block));

  export async function copy() {
    if (gm) return;
    try {
      if (block.type !== "image") await copyText(copiedText);
      else if (block.imageId) await copyImage(scenario.images.get(block.imageId)!.url);
      else await copyText(block.caption ?? "");
      failed = false;
      block.used = true;
      flash = true;
      clearTimeout(timer);
      timer = setTimeout(() => (flash = false), 1200);
      oncopied();
    } catch (e) {
      console.error(e);
      failed = true;
    }
  }

  function onclick(e: MouseEvent) {
    if (gm) return;
    // 그림 확대 버튼 등 카드 안의 다른 버튼은 복사하지 않는다.
    if ((e.target as HTMLElement).closest("button")) return;
    // 글자를 드래그해서 일부만 고르는 중이면 복사하지 않는다.
    if (window.getSelection()?.toString()) return;
    onselect();
    copy();
  }
</script>

<div
  class="row"
  class:used={block.used}
  class:selected
  class:flash
  class:heading={block.type === "sentence" && block.kind === "heading"}
  class:gm
  class:group={block.type === "group"}
  class:tagged={block.type === "group" && !!tags.get(block.tag)}
  style:--tag={block.type === "group" ? tags.get(block.tag)?.color : undefined}
  data-block-id={block.id}
  role="option"
  tabindex="-1"
  aria-selected={selected}
  title={gm ? "GM 정보 — 복사되지 않습니다" : "클릭하면 복사"}
  {onclick}
  onkeydown={() => {}}
>
  <span class="num">{index + 1}</span>
  <div class="content">
    {#if block.speaker}
      <span class="speaker" title="화자 — 복사되지 않습니다"><UserRound size={11} /> {block.speaker}</span>
    {/if}
    {#if block.type === "group"}
      <span class="group-label">
        <Group size={11} /> {scenario.groupLabels.get(block.id)}{block.title ? ` · ${block.title}` : ""}{gm ? " · 복사 안 됨" : ""}
      </span>
      <p>{text}</p>
    {:else if block.type === "sentence"}
      <p>{text}</p>
    {:else}
      <ImageView {block} compact zoomOnClick={false} />
    {/if}
    {#if block.note}
      <div class="note" title="GM 메모 — 복사되지 않습니다"><StickyNote size={12} /><span>{block.note}</span></div>
    {/if}
  </div>
  <span class="status" aria-hidden="true">
    {#if gm}<BookKey size={15} />{:else if flash}<Check size={15} />{:else if failed}<TriangleAlert size={15} />{:else}<Copy size={15} />{/if}
  </span>
</div>

<style>
  .row {
    display: grid;
    grid-template-columns: 40px 1fr 24px;
    gap: 10px;
    align-items: start;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    cursor: pointer;
    transition: border-color 0.12s, box-shadow 0.12s, background 0.12s;
  }

  .row:hover {
    border-color: var(--accent);
  }

  .row:active {
    background: var(--accent-soft);
  }

  .row.selected {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .row.flash {
    border-color: var(--ok);
    box-shadow: 0 0 0 3px var(--ok-soft);
  }

  /* 복사한 줄은 흐리게. 단, GM 메모는 계속 참고할 수 있게 그대로 둔다. */
  .row.used .content > :not(.note, .speaker),
  .row.used .num {
    opacity: 0.45;
  }

  .num {
    display: inline-flex;
    justify-content: flex-end;
    align-items: center;
    gap: 3px;
    padding-top: 3px;
    color: var(--text-faint);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .content {
    min-width: 0;
  }

  p {
    margin: 0;
    font-size: 15px;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: keep-all;
    overflow-wrap: anywhere;
  }

  .heading p {
    font-weight: 700;
  }

  /* GM 정보 그룹: 태그 색 바탕, 눌러도 복사되지 않는다 */
  .row.gm {
    cursor: default;
  }

  .row.gm:hover,
  .row.gm:active {
    border-color: var(--border);
    border-left-color: var(--tag);
    background: color-mix(in srgb, var(--tag) 16%, var(--surface));
  }

  .row.gm .status,
  .row.gm:hover .status {
    color: var(--tag);
  }

  /* 그룹: 여러 줄을 한 번에 복사하는 카드. 태그가 있으면 태그 색(--tag)으로 칠한다. */
  .row.group {
    border-left: 3px solid var(--text-faint);
    background: var(--surface-2);
  }

  .row.group.tagged {
    border-left-color: var(--tag);
    background: color-mix(in srgb, var(--tag) 16%, var(--surface));
  }

  .group-label {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    margin-bottom: 2px;
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 600;
    user-select: none;
    -webkit-user-select: none;
  }

  .tagged .group-label {
    color: color-mix(in srgb, var(--tag) 60%, var(--text));
  }

  /* 화자: 참고용. 복사되지 않는다. */
  .speaker {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    margin-bottom: 2px;
    color: var(--accent);
    font-size: 11px;
    font-weight: 600;
    user-select: none;
    -webkit-user-select: none;
  }

  /* GM 메모: 참고용. 복사에 포함되지 않고 드래그 선택도 막는다. */
  .note {
    display: flex;
    gap: 6px;
    align-items: baseline;
    margin-top: 6px;
    padding: 4px 8px;
    border-left: 3px solid var(--note);
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    background: var(--note-soft);
    color: var(--note);
    font-size: 13px;
    line-height: 1.5;
    white-space: pre-wrap;
    user-select: none;
    -webkit-user-select: none;
    cursor: default;
  }

  .note span {
    color: var(--text);
    opacity: 0.85;
  }

  .status {
    display: grid;
    place-items: center;
    height: 24px;
    color: var(--text-faint);
  }

  .row:hover .status {
    color: var(--accent);
  }

  .row.flash .status {
    color: var(--ok);
  }
</style>
