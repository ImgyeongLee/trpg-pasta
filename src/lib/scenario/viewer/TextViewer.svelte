<script lang="ts">
  import { untrack } from "svelte";
  import { layout } from "$lib/layout.svelte";
  import { scenario } from "../state.svelte";
  import { join, locate, squash } from "./match";
  import { acrossLine, jumpToSnippet } from "./sync";

  let { text }: { text: string } = $props();

  const lines = $derived(text.replace(/\r\n?/g, "\n").split("\n"));
  const joined = $derived(join(lines.map((str) => ({ str, rect: { x: 0, y: 0, w: 0, h: 0 } }))));
  /** 각 줄이 공백 뺀 전체 원문에서 시작하는 위치 */
  const starts = $derived.by(() => {
    let at = 0;
    return lines.map((line) => {
      const start = at;
      at += squash(line).length;
      return start;
    });
  });

  let scroller = $state<HTMLDivElement>();
  let marked = $state<{ from: number; to: number } | null>(null);
  let fromViewer = false;

  function scrollToLine(i: number) {
    const el = scroller?.querySelector<HTMLElement>(`[data-line="${i}"]`);
    if (el && scroller) scroller.scrollTo({ top: el.offsetTop - scroller.clientHeight / 3, behavior: "smooth" });
  }

  // 목록에서 고른 문장을 원문에서 찾아 표시한다. 같은 문장이 여러 번 나올 수 있어 그 집합의 줄 범위부터 찾는다.
  $effect(() => {
    const id = scenario.focusedId;
    if (!layout.viewerSync || id === null) return;
    untrack(() => {
      const found = scenario.find(id);
      if (!found || found.block.type !== "sentence") return;
      const range = scenario.sections[found.sectionIndex].range;
      const fromLine = Math.max(0, range.from - 1 - 50);
      const hit = locate(joined.text, found.block.text, starts[fromLine] ?? 0);
      if (!hit) {
        marked = null;
        return;
      }
      marked = { from: joined.owner[hit.start], to: joined.owner[hit.end] };
      if (!fromViewer) scrollToLine(marked.from);
      fromViewer = false;
    });
  });

  // 집합을 바꾸면 그 집합의 첫 줄로
  $effect(() => {
    const index = scenario.activeIndex;
    const section = scenario.sections[index];
    if (!layout.viewerSync || !section || section.range.unit !== "줄") return;
    untrack(() => {
      const focused = scenario.focusedId !== null ? scenario.find(scenario.focusedId) : null;
      if (focused?.sectionIndex === index) return;
      marked = null;
      scrollToLine(section.range.from - 1);
    });
  });

  function pick(i: number) {
    if (squash(lines[i]).length < 2) return;
    fromViewer = true;
    const ok = jumpToSnippet(acrossLine(lines[i]), (section) => i + 1 >= section.range.from - 50 && i + 1 <= section.range.to);
    if (!ok) fromViewer = false;
  }
</script>

<div class="scroller" bind:this={scroller}>
  <div class="text">
    {#each lines as line, i (i)}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div class="line" class:mark={marked && i >= marked.from && i <= marked.to} data-line={i} onclick={() => pick(i)}>
        <span class="no">{i + 1}</span><span class="body">{line || " "}</span>
      </div>
    {/each}
  </div>
</div>

<style>
  .scroller {
    flex: 1;
    min-height: 0;
    overflow: auto;
    background: var(--surface);
  }

  .text {
    padding: 8px 0 40px;
    font-size: 13px;
    line-height: 1.65;
  }

  .line {
    display: grid;
    grid-template-columns: 48px 1fr;
    gap: 10px;
    padding: 0 12px 0 0;
    cursor: pointer;
  }

  .line:hover {
    background: var(--surface-2);
  }

  .line.mark {
    background: rgb(255 214 0 / 28%);
    box-shadow: inset 3px 0 0 rgb(255 170 0);
  }

  .no {
    color: var(--text-faint);
    font-size: 11px;
    text-align: right;
    font-variant-numeric: tabular-nums;
    user-select: none;
  }

  .body {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
