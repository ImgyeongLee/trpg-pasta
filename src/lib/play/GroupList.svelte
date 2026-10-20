<script lang="ts">
  // 매크로 아래의 핸드아웃 모음 (「핸드아웃」 태그가 붙은 그룹만). 카드를 누르면 그룹 전체(여러 줄)가 한 번에 복사된다.
  import { copyText } from "$lib/clipboard";
  import { Check, Copy, Tag, TriangleAlert } from "$lib/icons";
  import { scenario } from "$lib/scenario/state.svelte";
  import { HANDOUT_TAG, tags } from "$lib/scenario/tags.svelte";
  import type { GroupBlock } from "$lib/scenario/types";

  let { compact = false }: { compact?: boolean } = $props();

  /** 채팅 매크로 쪽에는 핸드아웃만 모은다 (성공·실패 판정, 만든 태그는 시나리오 흐름에서만) */
  const sections = $derived(
    tags.all
      .filter((tag) => tag.id === HANDOUT_TAG)
      .map((tag) => ({ tag, items: scenario.groups.filter((g) => g.tag === tag.id) }))
      .filter((s) => s.items.length),
  );

  let flashId = $state<number | null>(null);
  let failedId = $state<number | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function copy(block: GroupBlock, e: MouseEvent) {
    // 글자를 드래그해서 일부만 고르는 중이면 복사하지 않는다.
    const selection = window.getSelection();
    if (selection?.toString() && (e.currentTarget as HTMLElement).contains(selection.anchorNode)) return;
    try {
      await copyText(scenario.finalText(block));
      block.used = true;
      failedId = null;
      flashId = block.id;
      clearTimeout(timer);
      timer = setTimeout(() => (flashId = null), 1200);
    } catch (err) {
      console.error(err);
      failedId = block.id;
    }
  }
</script>

<div class="tag-groups" class:compact>
  {#each sections as { tag, items } (tag.id)}
    <section style:--tag={tag.color}>
      <header>
        <span class="dot"></span>
        <h3>{tag.name}</h3>
        <span class="count">{items.length}</span>
      </header>
      <div class="cards">
        {#each items as block (block.id)}
          <button class="card" class:used={block.used} class:flash={flashId === block.id} onclick={(e) => copy(block, e)} title="누르면 전체를 복사">
            <span class="head">
              <span class="name">{scenario.groupLabels.get(block.id)}{block.title ? ` · ${block.title}` : ""}</span>
              <span class="status" aria-hidden="true">
                {#if flashId === block.id}<Check size={14} /> 복사됨{:else if failedId === block.id}<TriangleAlert size={14} />{:else}<Copy size={14} />{/if}
              </span>
            </span>
            <span class="text">{scenario.finalText(block)}</span>
          </button>
        {/each}
      </div>
    </section>
  {:else}
    <p class="empty muted">
      <Tag size={13} /> 시나리오 편집기에서 줄을 골라 「그룹으로 묶기」를 누르고 「핸드아웃」 태그를 붙이면 여기에 모입니다.
    </p>
  {/each}
</div>

<style>
  .tag-groups {
    display: flex;
    flex-direction: column;
    gap: 20px;
    margin-top: 24px;
    padding-top: 16px;
    border-top: 1px solid var(--border);
  }

  .compact {
    gap: 14px;
    margin-top: 16px;
  }

  header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 10px;
  }

  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--tag);
  }

  h3 {
    margin: 0;
    color: var(--text-muted);
    font-size: 13px;
  }

  .count {
    color: var(--text-faint);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 12px;
    align-items: start;
  }

  .compact .cards {
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 8px;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    padding: 10px 12px;
    border: 1px solid color-mix(in srgb, var(--tag) 40%, var(--border));
    border-left: 3px solid var(--tag);
    border-radius: 0 var(--radius) var(--radius) 0;
    background: color-mix(in srgb, var(--tag) 16%, var(--surface));
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: border-color 0.12s, box-shadow 0.12s;
  }

  .card:hover {
    border-color: var(--accent);
    border-left-color: var(--tag);
  }

  .card.flash {
    border-color: var(--ok);
    box-shadow: 0 0 0 3px var(--ok-soft);
  }

  .card.used .text {
    opacity: 0.5;
  }

  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }

  .name {
    overflow: hidden;
    color: color-mix(in srgb, var(--tag) 60%, var(--text));
    font-size: 12px;
    font-weight: 700;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .status {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 3px;
    color: var(--text-faint);
    font-size: 12px;
  }

  .card:hover .status {
    color: var(--accent);
  }

  .card.flash .status {
    color: var(--ok);
  }

  /* 긴 그룹은 몇 줄만 보이고, 복사는 전체가 된다. */
  .text {
    display: -webkit-box;
    overflow: hidden;
    font-size: 14px;
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: keep-all;
    overflow-wrap: anywhere;
    -webkit-line-clamp: 6;
    line-clamp: 6;
    -webkit-box-orient: vertical;
  }

  .empty {
    display: flex;
    gap: 6px;
    align-items: baseline;
    margin: 0;
    font-size: 13px;
  }
</style>
