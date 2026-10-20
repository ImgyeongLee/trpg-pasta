<script lang="ts">
  // 대사의 화자 메모. 눌러서 추천 목록에서 고르거나(숫자 1~9) 새 이름을 입력한다. 복사되지 않는다.
  import { Plus, UserRound, X } from "$lib/icons";
  import { scenario } from "./state.svelte";
  import type { Block } from "./types";

  let { block }: { block: Block } = $props();

  let open = $state(false);
  let query = $state("");
  let root = $state<HTMLSpanElement>();
  let input = $state<HTMLInputElement>();

  const suggestions = $derived(
    scenario.speakerSuggestions.filter((s) => s !== block.speaker && s.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 9),
  );

  function show() {
    query = "";
    open = true;
    queueMicrotask(() => input?.focus());
  }

  function choose(name: string) {
    scenario.setSpeaker(block, name);
    open = false;
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      open = false;
    } else if (e.key === "Enter") {
      e.preventDefault();
      const typed = query.trim();
      if (typed) choose(typed);
      else if (suggestions[0]) choose(suggestions[0]);
    } else if (/^[1-9]$/.test(e.key) && !query) {
      // 입력칸이 비어 있을 때 숫자는 추천 목록 번호
      const pick = suggestions[Number(e.key) - 1];
      if (pick) {
        e.preventDefault();
        choose(pick);
      }
    }
  }

  $effect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root?.contains(e.target as Node)) open = false;
    };
    window.addEventListener("pointerdown", onPointer, true);
    return () => window.removeEventListener("pointerdown", onPointer, true);
  });
</script>

<span class="speaker" bind:this={root}>
  {#if block.speaker}
    <span class="tag" title="대사의 화자 (복사되지 않음)">
      <button class="name" onclick={show}><UserRound size={11} /> {block.speaker}</button>
      <button class="clear" onclick={() => scenario.setSpeaker(block, undefined)} title="화자 지우기" aria-label="화자 지우기"><X size={11} /></button>
    </span>
  {:else}
    <button class="add" onclick={show} title="이 대사를 누가 말하는지 메모 (복사되지 않음)"><Plus size={11} /> 화자</button>
  {/if}

  {#if open}
    <div class="pop" role="dialog" aria-label="화자 고르기">
      <input bind:this={input} class="input" bind:value={query} placeholder="화자 이름 (Enter)" {onkeydown} aria-label="화자 이름" />
      {#if suggestions.length}
        <div class="chips">
          {#each suggestions as name, i (name)}
            <button class="chip" onclick={() => choose(name)}><span class="key">{i + 1}</span>{name}</button>
          {/each}
        </div>
      {:else if !scenario.speakerSuggestions.length}
        <p class="hint">이름을 입력하면 다음부터 추천 목록에 나옵니다.</p>
      {/if}
    </div>
  {/if}
</span>

<style>
  .speaker {
    position: relative;
    display: inline-flex;
  }

  .tag {
    display: inline-flex;
    align-items: center;
    height: 20px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 11px;
    font-weight: 600;
  }

  .tag button {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    height: 100%;
    border: 0;
    background: transparent;
    color: inherit;
  }

  .name {
    padding: 0 4px 0 7px;
  }

  .clear {
    padding: 0 6px 0 2px;
    opacity: 0.6;
  }

  .clear:hover {
    opacity: 1;
  }

  .add {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    height: 20px;
    padding: 0 7px;
    border: 1px dashed var(--border-strong);
    border-radius: 999px;
    background: transparent;
    color: var(--text-faint);
    font-size: 11px;
  }

  .add:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .pop {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 30;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 260px;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: 0 8px 28px rgb(20 15 5 / 16%), 0 2px 6px rgb(20 15 5 / 8%);
  }

  .pop .input {
    height: 30px;
    font-size: 13px;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 26px;
    padding: 0 9px 0 4px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--text);
    font-size: 12px;
  }

  .chip:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .key {
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--surface-3);
    color: var(--text-muted);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }

  .hint {
    margin: 0;
    color: var(--text-muted);
    font-size: 11px;
  }
</style>
