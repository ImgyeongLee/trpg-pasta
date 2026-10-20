<script lang="ts">
  import { tick } from "svelte";
  import { LoaderCircle, Merge, Pencil, Plus } from "$lib/icons";
  import ConfirmButton from "$lib/ui/ConfirmButton.svelte";
  import { scenario } from "./state.svelte";

  /** 삭제 확인 대기 중인 집합 (그 줄을 빨갛게 표시) */
  let armed = $state<Record<number, boolean>>({});

  // ── 이름 바꾸기: 이름을 두 번 누르거나 연필 버튼 ──
  let renamingId = $state<number | null>(null);
  let draft = $state("");

  async function startRename(id: number, label: string) {
    renamingId = id;
    draft = label;
    await tick();
    const input = document.querySelector<HTMLInputElement>(".rename-input");
    input?.focus();
    input?.select();
  }

  function commitRename() {
    if (renamingId !== null) scenario.renameSection(renamingId, draft);
    renamingId = null;
  }

  async function addSection() {
    const id = scenario.addSection();
    await startRename(id, "새 집합");
  }
</script>

<nav class="sections" aria-label="집합">
  <h2>집합</h2>
  {#each scenario.sections as section, i (section.id)}
    <div class="section" class:active={i === scenario.activeIndex} class:armed={armed[section.id]}>
      {#if renamingId === section.id}
        <input
          class="input rename-input"
          bind:value={draft}
          aria-label="집합 이름"
          onkeydown={(e) => {
            if (e.isComposing || e.keyCode === 229) return;
            if (e.key === "Enter") commitRename();
            else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              renamingId = null;
            }
          }}
          onblur={commitRename}
        />
      {/if}
      <button
        class="pick"
        class:hidden={renamingId === section.id}
        onclick={() => (scenario.activeIndex = i)}
        ondblclick={() => startRename(section.id, section.label)}
        title="두 번 누르면 이름 바꾸기"
      >
        <span class="section-top">
          <span class="name">{i + 1}. {section.label}</span>
        </span>
        <span class="section-sub muted">{section.blocks.length}줄</span>
      </button>
      <span class="actions" class:show={armed[section.id]} class:hidden={renamingId === section.id}>
        {#if !armed[section.id]}
          <button class="icon-btn small" onclick={() => startRename(section.id, section.label)} title="이름 바꾸기" aria-label="이름 바꾸기">
            <Pencil size={13} />
          </button>
        {/if}
        {#if i < scenario.sections.length - 1 && !armed[section.id]}
          <button
            class="icon-btn merge"
            onclick={() => scenario.mergeWithNext(i)}
            title="아래 집합({i + 2}. {scenario.sections[i + 1].label})과 합치기 — 「되돌리기」로 다시 나눌 수 있어요"
            aria-label="아래 집합과 합치기"
          >
            <Merge size={14} />
          </button>
        {/if}
        <ConfirmButton
          onarmchange={(on) => (armed[section.id] = on)}
          title="집합 삭제 (두 번 눌러야 지워지고, 「되돌리기」로 살릴 수 있어요)"
          confirmLabel="한 번 더 눌러 삭제"
          onconfirm={() => scenario.removeSection(section.id)}
        />
      </span>
    </div>
  {/each}
  {#if scenario.status !== "processing" && scenario.sections.length}
    <button class="btn sm add" onclick={addSection} title="지금 집합 바로 뒤에 빈 집합 만들기"><Plus size={14} /> 새 집합</button>
  {/if}
  {#if scenario.status === "processing"}
    <div class="pending muted"><LoaderCircle size={14} class="spin" /> 다음 집합 정리 중</div>
  {/if}
</nav>

<style>
  .sections {
    display: flex;
    flex-direction: column;
    gap: 4px;
    height: 100%;
    padding: 12px 10px;
    overflow-y: auto;
  }

  h2 {
    margin: 0 6px 6px;
    font-size: 12px;
    color: var(--text-muted);
  }

  .section {
    position: relative;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
  }

  .section:hover {
    background: var(--surface);
  }

  .section.active {
    border-color: var(--border);
    background: var(--surface);
    box-shadow: var(--shadow);
  }

  .pick {
    display: flex;
    flex-direction: column;
    gap: 3px;
    width: 100%;
    padding: 8px 86px 8px 10px;
    border: 0;
    background: transparent;
    text-align: left;
  }

  .section-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 4px;
    font-size: 13px;
    font-weight: 500;
  }

  .section-sub {
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .actions {
    position: absolute;
    top: 6px;
    right: 4px;
    display: flex;
    gap: 2px;
    padding-left: 6px;
    background: inherit;
    opacity: 0;
    transition: opacity 0.1s;
  }

  .section:hover .actions,
  .actions:focus-within,
  .actions.show {
    opacity: 1;
  }

  .small {
    width: 26px;
    height: 26px;
  }

  .hidden {
    display: none !important;
  }

  .rename-input {
    width: 100%;
    height: 34px;
    margin: 4px 0;
    font-size: 13px;
    font-weight: 500;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .add {
    align-self: flex-start;
    margin: 6px 4px 0;
  }

  .merge {
    width: 26px;
    height: 26px;
    transform: rotate(180deg);
  }

  .merge:hover {
    color: var(--accent);
    background: var(--accent-soft);
  }

  /* 삭제 확인 대기 중: 지워질 집합을 분명히 보여준다 */
  .section.armed {
    border-color: var(--danger);
    background: var(--danger-soft);
  }

  .pending {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    font-size: 12px;
  }
</style>
