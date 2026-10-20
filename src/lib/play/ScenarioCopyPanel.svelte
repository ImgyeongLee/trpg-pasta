<script lang="ts">
  import { untrack } from "svelte";
  import { copyText } from "$lib/clipboard";
  import { BookOpen, ChevronLeft, ChevronRight, Copy, LoaderCircle, RotateCcw } from "$lib/icons";
  import CopyRow from "$lib/scenario/CopyRow.svelte";
  import { scenario } from "$lib/scenario/state.svelte";
  import { isSecret } from "$lib/scenario/tags.svelte";
  import Select from "$lib/ui/Select.svelte";
  import type { GroupBlock, SentenceBlock } from "$lib/scenario/types";

  let { active = true }: { active?: boolean } = $props();

  const rows = $derived((scenario.active?.blocks ?? []).map((block, index) => ({ block, index })));

  const sectionOptions = $derived(
    scenario.sections.map((s, i) => ({ value: String(i), label: `${i + 1}. ${s.label}`, hint: `${s.blocks.length}줄` })),
  );

  let selectedId = $state<number | null>(null);
  let copyRows: Record<number, CopyRow> = $state({});
  let list = $state<HTMLDivElement>();

  function reveal(id: number) {
    list?.querySelector(`[data-block-id="${id}"]`)?.scrollIntoView({ block: "nearest" });
  }

  // 복사 페이지를 열면 편집기 커서가 있던 줄의 카드에서 시작한다.
  $effect(() => {
    untrack(() => {
      const id = scenario.focusedId;
      if (id === null || !rows.some((r) => r.block.id === id)) return;
      selectedId = id;
      list?.querySelector(`[data-block-id="${id}"]`)?.scrollIntoView({ block: "center" });
    });
  });

  function selectRelative(step: 1 | -1) {
    if (!rows.length) return;
    const i = rows.findIndex((r) => r.block.id === selectedId);
    const next = rows[Math.max(0, Math.min(rows.length - 1, i < 0 ? 0 : i + step))];
    selectedId = next.block.id;
    reveal(next.block.id);
  }

  function stepSection(step: 1 | -1) {
    const next = scenario.activeIndex + step;
    if (next >= 0 && next < scenario.sections.length) scenario.activeIndex = next;
  }

  function onWindowKeydown(e: KeyboardEvent) {
    if (!active || e.defaultPrevented) return;
    const target = e.target as HTMLElement;
    // 매크로 입력칸·드롭다운 등에서는 키를 가로채지 않는다.
    if (target.closest("input, textarea, [role=listbox], .macro-panel")) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      selectRelative(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      selectRelative(-1);
    } else if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && !target.closest("button")) {
      e.preventDefault();
      stepSection(e.key === "ArrowRight" ? 1 : -1);
    } else if (e.key === "Enter" && selectedId !== null && !target.closest("button, [role=button]")) {
      e.preventDefault();
      copyRows[selectedId]?.copy();
    }
  }

  let sectionCopied = $state(false);
  async function copySection() {
    const section = scenario.active;
    if (!section) return;
    const text = section.blocks
      .filter((b): b is SentenceBlock | GroupBlock => b.type !== "image" && !isSecret(b))
      .map((b) => scenario.finalText(b))
      .join("\n");
    await copyText(text);
    sectionCopied = true;
    setTimeout(() => (sectionCopied = false), 1200);
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

<section class="panel" aria-label="시나리오">
  <header>
    <div class="nav">
      <BookOpen size={15} class="icon" />
      <button class="icon-btn" onclick={() => stepSection(-1)} disabled={scenario.activeIndex <= 0} title="이전 집합 (←)">
        <ChevronLeft size={16} />
      </button>
      {#if sectionOptions.length}
        <Select label="집합" size="sm" options={sectionOptions} value={String(scenario.activeIndex)} onchange={(v) => (scenario.activeIndex = Number(v))} />
      {/if}
      <button class="icon-btn" onclick={() => stepSection(1)} disabled={scenario.activeIndex >= scenario.sections.length - 1} title="다음 집합 (→)">
        <ChevronRight size={16} />
      </button>
      {#if scenario.status === "processing"}
        <span class="muted processing"><LoaderCircle size={12} class="spin" /> {scenario.progress.done}/{scenario.progress.total}{scenario.progress.unit}</span>
      {/if}
    </div>
    <div class="tools">
      <button class="btn sm" onclick={() => scenario.resetUsed()} title="복사해서 흐려진 줄을 다시 선명하게"><RotateCcw size={14} /> 사용 표시 지우기</button>
      <button class="btn sm" onclick={copySection} disabled={!scenario.active}><Copy size={14} /> {sectionCopied ? "복사됨" : "집합 전체 복사"}</button>
    </div>
  </header>

  <div class="list" role="listbox" aria-label="복사할 문장" bind:this={list}>
    {#each rows as { block, index }, i (block.id)}
      <CopyRow
        bind:this={copyRows[block.id]}
        {block}
        {index}
        selected={selectedId === block.id}
        onselect={() => (selectedId = block.id)}
        oncopied={() => {
          // 다음 줄로 넘어가되 GM 정보 그룹은 건너뛴다 (복사할 일이 없으니)
          const next = rows.slice(i + 1).find((r) => !isSecret(r.block));
          if (next) {
            selectedId = next.block.id;
            reveal(next.block.id);
          }
        }}
      />
    {:else}
      <p class="empty muted">
        {scenario.sourceName ? "이 집합에 문장이 없습니다." : "「시나리오 준비」에서 시나리오를 불러오면 여기에 문장이 나옵니다."}
      </p>
    {/each}
  </div>
  <p class="keys muted">카드를 누르면 복사 · ↑↓ 고르기 · Enter 복사 · ←→ 집합 이동 · Esc 편집으로</p>
</section>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }

  header {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
  }

  .nav,
  .tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
  }

  .nav :global(.icon) {
    margin-right: 4px;
    color: var(--accent);
  }

  .processing {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: 6px;
    font-size: 12px;
  }

  .list {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px 14px 24px;
    overflow-y: auto;
  }

  .empty {
    padding: 40px 16px;
    text-align: center;
  }

  .keys {
    margin: 0;
    padding: 6px 14px 8px;
    border-top: 1px solid var(--border);
    font-size: 11px;
  }
</style>
