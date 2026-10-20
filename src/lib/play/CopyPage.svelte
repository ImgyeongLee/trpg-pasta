<script lang="ts">
  // 복사 페이지: 게임 진행 중에 시나리오 문장과 채팅 매크로를 눌러서 바로 복사한다.
  // Esc를 누르면 직전 편집 페이지로 돌아간다.
  import { ArrowLeft, BookOpen, Columns2, Rows2, SquareTerminal } from "$lib/icons";
  import { layout, type CopyArrangement } from "$lib/layout.svelte";
  import MacroList from "$lib/macros/MacroList.svelte";
  import { macros } from "$lib/macros/state.svelte";
  import Select from "$lib/ui/Select.svelte";
  import type { SelectOption } from "$lib/ui/select";
  import PinButton from "$lib/ui/PinButton.svelte";
  import Splitter from "$lib/ui/Splitter.svelte";
  import GroupList from "./GroupList.svelte";
  import ScenarioCopyPanel from "./ScenarioCopyPanel.svelte";

  let { onclose, backLabel }: { onclose: () => void; backLabel: string } = $props();

  const arrangements: SelectOption<CopyArrangement>[] = [
    { value: "scenario-left", label: "시나리오 왼쪽 · 매크로 오른쪽", icon: Columns2 },
    { value: "macros-left", label: "매크로 왼쪽 · 시나리오 오른쪽", icon: Columns2 },
    { value: "scenario-top", label: "시나리오 위 · 매크로 아래", icon: Rows2 },
    { value: "macros-top", label: "매크로 위 · 시나리오 아래", icon: Rows2 },
  ];

  const vertical = $derived(layout.copyArrangement.endsWith("-top"));
  const macrosFirst = $derived(layout.copyArrangement.startsWith("macros"));
  const both = $derived(layout.showScenario && layout.showMacros);

  function onWindowKeydown(e: KeyboardEvent) {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    e.preventDefault();
    const target = e.target as HTMLElement;
    // 입력 중이면 먼저 입력칸에서만 빠져나온다.
    if (target.closest("input, textarea")) {
      target.blur();
      return;
    }
    onclose();
  }

  $effect(() => {
    macros.load();
  });
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#snippet scenarioPanel()}
  <div class="slot scenario" style:order={macrosFirst ? 3 : 1}>
    <ScenarioCopyPanel />
  </div>
{/snippet}

{#snippet macroPanel()}
  <div
    class="slot macro-panel"
    style:order={macrosFirst ? 1 : 3}
    style:flex-basis={both ? `${layout.macroSize}px` : undefined}
    class:fill={!both}
  >
    <header class="macro-head"><SquareTerminal size={15} /> 채팅 매크로</header>
    <div class="macro-body">
      {#if macros.loaded}
        <MacroList compact />
        {#if macros.macros.length === 0}
          <p class="muted empty">「채팅 매크로」 페이지에서 매크로를 추가하세요.</p>
        {/if}
      {/if}
      <GroupList compact />
    </div>
  </div>
{/snippet}

<div class="page">
  <header class="bar">
    <button class="btn ghost" onclick={onclose} title="편집 페이지로 돌아가기 (Esc)">
      <ArrowLeft size={16} /> {backLabel} <kbd>Esc</kbd>
    </button>
    <h1>복사</h1>
    <div class="controls">
      <PinButton />
      <span class="divider"></span>
      <button
        class="icon-btn"
        class:on={layout.showScenario}
        onclick={() => (layout.showScenario = !layout.showScenario || !layout.showMacros)}
        title={layout.showScenario ? "시나리오 패널 숨기기" : "시나리오 패널 보이기"}
        aria-pressed={layout.showScenario}
      >
        <BookOpen size={17} />
      </button>
      <button
        class="icon-btn"
        class:on={layout.showMacros}
        onclick={() => (layout.showMacros = !layout.showMacros || !layout.showScenario)}
        title={layout.showMacros ? "매크로 패널 숨기기" : "매크로 패널 보이기"}
        aria-pressed={layout.showMacros}
      >
        <SquareTerminal size={17} />
      </button>
      <Select label="패널 배치" size="sm" options={arrangements} bind:value={layout.copyArrangement} />
    </div>
  </header>

  <div class="panels" class:vertical>
    {#if layout.showScenario}{@render scenarioPanel()}{/if}
    {#if both}
      <div class="split" style:order="2">
        <Splitter
          bind:size={layout.macroSize}
          direction={vertical ? "vertical" : "horizontal"}
          invert={macrosFirst}
          min={vertical ? 160 : 260}
          max={vertical ? 700 : 900}
          label="매크로 패널 크기 조절"
        />
      </div>
    {/if}
    {#if layout.showMacros}{@render macroPanel()}{/if}
  </div>
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }

  .bar {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 12px;
    padding: 8px 14px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }

  .bar > :first-child {
    justify-self: start;
  }

  h1 {
    margin: 0;
    font-size: 15px;
  }

  .controls {
    display: flex;
    justify-self: end;
    align-items: center;
    gap: 4px;
  }

  .divider {
    width: 1px;
    height: 18px;
    margin: 0 4px;
    background: var(--border);
  }

  .icon-btn.on {
    color: var(--accent);
    background: var(--accent-soft);
  }

  kbd {
    padding: 1px 5px;
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    background: var(--surface-2);
    font-family: inherit;
    font-size: 11px;
  }

  .panels {
    display: flex;
    flex: 1;
    min-height: 0;
  }

  .panels.vertical {
    flex-direction: column;
  }

  .slot {
    min-width: 0;
    min-height: 0;
  }

  .scenario {
    flex: 1 1 0;
  }

  .macro-panel {
    display: flex;
    flex: 0 0 auto;
    flex-direction: column;
    background: var(--surface-2);
  }

  .macro-panel.fill {
    flex: 1 1 0;
  }

  .split {
    display: flex;
  }

  .macro-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border);
    font-weight: 600;
  }

  .macro-head :global(svg) {
    color: var(--accent);
  }

  .macro-body {
    flex: 1;
    padding: 14px;
    overflow-y: auto;
  }

  .empty {
    padding: 24px 8px;
    text-align: center;
  }
</style>
