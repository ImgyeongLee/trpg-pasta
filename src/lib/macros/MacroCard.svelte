<script lang="ts">
  import { copyText } from "$lib/clipboard";
  import { ArrowDown, ArrowUp, Check, Copy } from "$lib/icons";
  import ConfirmButton from "$lib/ui/ConfirmButton.svelte";
  import Select from "$lib/ui/Select.svelte";
  import { macros, type Macro } from "./state.svelte";
  import { missing, parseVars, render, segments } from "./template";

  let { macro, editing = false, compact = false }: { macro: Macro; editing?: boolean; compact?: boolean } = $props();

  const vars = $derived(parseVars(macro.body));
  const parts = $derived(segments(macro.body));
  const groupOptions = $derived(macros.groups.map((g) => ({ value: g, label: g })));

  let card = $state<HTMLDivElement>();
  let flash = $state(false);
  let failed = $state<string[]>([]);
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function copy() {
    const empty = missing(macro.body, macro.values);
    if (empty.length) {
      // 비어 있는 입력칸으로 안내하고 복사하지 않는다.
      failed = empty;
      card?.querySelector<HTMLInputElement>(`input[data-var="${CSS.escape(empty[0])}"]`)?.focus();
      return;
    }
    failed = [];
    await copyText(render(macro.body, macro.values));
    flash = true;
    clearTimeout(timer);
    timer = setTimeout(() => (flash = false), 1200);
  }

  function setValue(name: string, value: string) {
    macro.values[name] = value;
    failed = failed.filter((n) => n !== name);
  }

  /** 선택 버튼: 값을 고르고, 다른 칸이 모두 채워져 있으면 바로 복사한다. 비어 있으면 그 칸으로 안내한다. */
  function choose(name: string, value: string) {
    setValue(name, value);
    copy();
  }

  /** 사용 모드: 카드 아무 곳이나 누르면 복사. 입력칸·선택 버튼은 원래 동작을 한다. */
  function onCardClick(e: MouseEvent) {
    if (editing) return;
    if ((e.target as HTMLElement).closest("input, textarea, button, a")) return;
    if (window.getSelection()?.toString()) return;
    copy();
  }

  function onCardKeydown(e: KeyboardEvent) {
    if (editing || e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      copy();
    }
  }

</script>

<!-- 사용 모드에서는 카드 전체가 복사 버튼(role=button), 편집 모드에서는 일반 영역이다. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class="card"
  class:compact
  class:editing
  class:flash
  bind:this={card}
  role={editing ? undefined : "button"}
  tabindex={editing ? undefined : 0}
  title={editing ? undefined : "클릭하면 복사"}
  onclick={onCardClick}
  onkeydown={onCardKeydown}
>
  {#if editing}
    <div class="edit-head">
      <input class="input name-input" bind:value={macro.name} placeholder="이름" aria-label="매크로 이름" />
      <button class="icon-btn" onclick={() => macros.move(macro.id, -1)} title="앞으로"><ArrowUp size={15} /></button>
      <button class="icon-btn" onclick={() => macros.move(macro.id, 1)} title="뒤로"><ArrowDown size={15} /></button>
      <ConfirmButton title="매크로 삭제 (두 번 눌러야 지워집니다)" onconfirm={() => macros.remove(macro.id)} />
    </div>
    <textarea class="body-input" bind:value={macro.body} rows="2" spellcheck="false" placeholder={"예: CC<={수치} 【{기능:관찰력/듣기}】"}></textarea>
    <div class="edit-foot">
      <Select label="그룹" size="sm" options={groupOptions} bind:value={macro.group} />
      {#if vars.length}
        <span class="var-list muted">변수: {vars.map((v) => v.name).join(", ")}</span>
      {/if}
    </div>
  {:else}
    <div class="head">
      <strong class="title">{macro.name || "이름 없음"}</strong>
      <span class="status" class:done={flash} aria-hidden="true">
        {#if flash}<Check size={14} /> 복사됨{:else}<Copy size={14} />{/if}
      </span>
    </div>
    {#if vars.length}
      <div class="vars">
        {#each vars as v (v.name)}
          <div class="var" class:invalid={failed.includes(v.name)}>
            <span class="var-name">{v.name}</span>
            {#if v.choices.length}
              <div class="chips">
                {#each v.choices as choice (choice)}
                  <button class="chip" class:on={macro.values[v.name] === choice} onclick={() => choose(v.name, choice)}>{choice}</button>
                {/each}
              </div>
            {:else}
              <input
                class="input var-input"
                data-var={v.name}
                value={macro.values[v.name] ?? ""}
                placeholder={v.name}
                oninput={(e) => setValue(v.name, e.currentTarget.value)}
                onkeydown={(e) => {
                  if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) {
                    e.preventDefault();
                    copy();
                  }
                }}
              />
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  {/if}
  <div class="preview" title="복사될 내용">
    {#each parts as part, i (i)}
      {#if "text" in part}{part.text}{:else if macro.values[part.var]}<mark>{macro.values[part.var]}</mark>{:else}<span class="slot"
          >{part.var}</span
        >{/if}
    {/each}
    {#if !parts.length}<span class="muted">(비어 있음)</span>{/if}
  </div>
</div>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
  }

  .card.compact {
    gap: 8px;
    padding: 10px;
  }

  .head,
  .edit-head,
  .edit-foot {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .card:not(.editing) {
    cursor: pointer;
    transition: border-color 0.12s, box-shadow 0.12s;
  }

  .card:not(.editing):hover,
  .card:not(.editing):focus-visible {
    outline: none;
    border-color: var(--accent);
  }

  .card.flash {
    border-color: var(--ok) !important;
    box-shadow: 0 0 0 3px var(--ok-soft);
  }

  .status {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--text-faint);
    font-size: 12px;
    font-weight: 600;
  }

  .card:hover .status {
    color: var(--accent);
  }

  .status.done {
    color: var(--ok) !important;
  }

  .vars {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .var {
    display: grid;
    grid-template-columns: 64px 1fr;
    gap: 8px;
    align-items: center;
  }

  .var-name {
    overflow: hidden;
    color: var(--text-muted);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .var-input {
    cursor: text;
    height: 28px;
    font-size: 13px;
  }

  .var.invalid .var-input {
    border-color: var(--danger);
    box-shadow: 0 0 0 3px var(--danger-soft);
  }

  .var.invalid .var-name {
    color: var(--danger);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .chip {
    height: 26px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface-2);
    font-size: 12px;
  }

  .chip:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .chip.on {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--accent-contrast);
  }

  .var.invalid .chips {
    border-radius: 999px;
    box-shadow: 0 0 0 2px var(--danger-soft);
  }

  .preview {
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    font-size: 13px;
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  mark {
    border-radius: 3px;
    background: var(--accent-soft);
    color: var(--accent);
  }

  .slot {
    padding: 0 4px;
    border: 1px dashed var(--border-strong);
    border-radius: 3px;
    color: var(--text-faint);
    font-size: 12px;
  }

  .name-input {
    flex: 1;
    height: 30px;
    font-weight: 600;
  }

  .body-input {
    width: 100%;
    min-height: 56px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 13px;
    resize: vertical;
  }

  .body-input:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .var-list {
    font-size: 12px;
  }

</style>
