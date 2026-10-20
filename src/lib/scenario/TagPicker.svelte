<script lang="ts">
  // 그룹 태그 고르기: 프리셋(핸드아웃·성공 판정·실패 판정) + 만든 태그 + 「태그 없음」.
  // 맨 아래에서 새 태그를 만들 수 있고(이름·색), 만든 태그는 연필 버튼으로 고치거나 지운다.
  import { Check, ChevronDown, Pencil, Plus, Tag } from "$lib/icons";
  import ConfirmButton from "$lib/ui/ConfirmButton.svelte";
  import { isHexColor, TAG_SWATCHES, tags } from "./tags.svelte";

  let { value, onchange, size = "sm" }: { value: string | undefined; onchange: (tag: string | undefined) => void; size?: "sm" | "md" } = $props();

  let open = $state(false);
  /** list: 태그 목록 / new: 새 태그 / 그 밖: 고치는 태그 id */
  let mode = $state<"list" | "new" | string>("list");
  let draftName = $state("");
  let draftColor = $state(TAG_SWATCHES[0]);
  let hex = $state(TAG_SWATCHES[0]);
  let trigger = $state<HTMLButtonElement>();
  let menu = $state<HTMLDivElement>();
  let position = $state({ top: 0, left: 0, flip: false });

  const current = $derived(tags.get(value));
  const editing = $derived(mode !== "list" && mode !== "new" ? tags.get(mode) : undefined);
  const canSave = $derived(!!draftName.trim() && isHexColor(draftColor));

  /** 메뉴를 body로 옮겨 편집기·스크롤 영역에 잘리지 않게 한다. */
  function portal(node: HTMLElement) {
    document.body.append(node);
    return { destroy: () => node.remove() };
  }

  /** 메뉴가 body로 옮겨진 뒤에 포커스를 준다 (autofocus는 옮기기 전에 실행돼 듣지 않는다). */
  function focusSoon(node: HTMLInputElement) {
    requestAnimationFrame(() => node.focus());
  }

  function place() {
    if (!trigger) return;
    const r = trigger.getBoundingClientRect();
    const estimated = 360;
    const flip = r.bottom + estimated > window.innerHeight - 8 && r.top > estimated;
    position = { top: flip ? r.top - 6 : r.bottom + 6, left: Math.min(r.left, window.innerWidth - 280), flip };
  }

  function show() {
    place();
    mode = "list";
    open = true;
  }

  function close() {
    open = false;
    mode = "list";
  }

  function choose(id: string | undefined) {
    if (id !== value) onchange(id);
    close();
  }

  function startNew() {
    draftName = "";
    draftColor = hex = TAG_SWATCHES[tags.custom.length % TAG_SWATCHES.length];
    mode = "new";
  }

  function startEdit(id: string) {
    const tag = tags.get(id);
    if (!tag) return;
    draftName = tag.name;
    draftColor = hex = tag.color;
    mode = id;
  }

  function pickColor(color: string) {
    draftColor = hex = color;
  }

  function save() {
    if (!canSave) return;
    if (mode === "new") choose(tags.add(draftName, draftColor));
    else {
      tags.update(mode, { name: draftName, color: draftColor });
      mode = "list";
    }
  }

  function remove(id: string) {
    tags.remove(id);
    if (value === id) onchange(undefined);
    mode = "list";
  }

  $effect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!menu?.contains(target) && !trigger?.contains(target)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (mode !== "list") mode = "list";
      else {
        close();
        trigger?.focus();
      }
    };
    // 스크롤하면 단추를 따라가고, 단추가 화면 밖으로 나가면 닫는다. (내용이 바뀔 때 생기는 스크롤로 닫히지 않게)
    const onScroll = (e: Event) => {
      if (menu?.contains(e.target as Node) || !trigger) return;
      const r = trigger.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) close();
      else place();
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
    };
  });
</script>

<button
  bind:this={trigger}
  type="button"
  class="chip {size}"
  class:empty={!current}
  class:open
  style:--tag={current?.color}
  aria-haspopup="listbox"
  aria-expanded={open}
  title="태그 고르기"
  onclick={() => (open ? close() : show())}
>
  {#if current}<span class="dot"></span>{current.name}{:else}<Tag size={12} /> 태그 붙이기{/if}
  <ChevronDown size={12} class="chevron" />
</button>

{#if open}
  <div
    bind:this={menu}
    use:portal
    class="menu"
    class:flip={position.flip}
    role={mode === "list" ? "listbox" : "dialog"}
    aria-label="그룹 태그"
    tabindex="-1"
    style:top="{position.top}px"
    style:left="{position.left}px"
  >
    {#if mode === "list"}
      {#each tags.all as tag (tag.id)}
        <div class="option" class:selected={tag.id === value} style:--tag={tag.color}>
          <button type="button" class="pick" role="option" aria-selected={tag.id === value} onclick={() => choose(tag.id)}>
            <span class="dot"></span>
            <span class="name">{tag.name}</span>
            {#if tag.id === value}<Check size={14} />{/if}
          </button>
          {#if !tag.preset}
            <button type="button" class="icon-btn small" onclick={() => startEdit(tag.id)} title="태그 고치기" aria-label="{tag.name} 태그 고치기">
              <Pencil size={13} />
            </button>
          {/if}
        </div>
      {/each}
      <div class="option" class:selected={!value}>
        <button type="button" class="pick" role="option" aria-selected={!value} onclick={() => choose(undefined)}>
          <span class="dot none"></span>
          <span class="name muted">태그 없음</span>
          {#if !value}<Check size={14} />{/if}
        </button>
      </div>
      <div class="divider"></div>
      <button type="button" class="add" onclick={startNew}><Plus size={14} /> 새 태그 만들기</button>
    {:else}
      <form
        class="form"
        onsubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <p class="form-title">{mode === "new" ? "새 태그" : "태그 고치기"}</p>
        <input class="input" bind:value={draftName} use:focusSoon placeholder="태그 이름 (예: 단서, 광기)" aria-label="태그 이름" spellcheck="false" />
        <div class="swatches" role="radiogroup" aria-label="태그 색">
          {#each TAG_SWATCHES as color (color)}
            <button
              type="button"
              class="swatch"
              class:on={draftColor.toLowerCase() === color}
              style:--tag={color}
              role="radio"
              aria-checked={draftColor.toLowerCase() === color}
              aria-label="색 {color}"
              onclick={() => pickColor(color)}
            ></button>
          {/each}
        </div>
        <label class="hex">
          <span class="swatch preview" style:--tag={isHexColor(draftColor) ? draftColor : undefined}></span>
          <input
            class="input"
            value={hex}
            placeholder="#rrggbb"
            aria-label="색 코드"
            spellcheck="false"
            oninput={(e) => {
              hex = e.currentTarget.value.trim();
              const v = hex.startsWith("#") ? hex : `#${hex}`;
              if (isHexColor(v)) draftColor = v.toLowerCase();
            }}
          />
        </label>
        <div class="preview-row">
          <span class="chip sm" style:--tag={isHexColor(draftColor) ? draftColor : undefined}><span class="dot"></span>{draftName.trim() || "태그 이름"}</span>
        </div>
        <div class="actions">
          {#if editing}
            <ConfirmButton
              variant="button"
              label="지우기"
              title="태그 지우기 (두 번 눌러야 지워집니다)"
              confirmLabel="한 번 더 눌러 지우기"
              onconfirm={() => remove(editing.id)}
            />
          {/if}
          <span class="spacer"></span>
          <button type="button" class="btn sm" onclick={() => (mode = "list")}>취소</button>
          <button type="submit" class="btn sm primary" disabled={!canSave}>{mode === "new" ? "만들기" : "저장"}</button>
        </div>
      </form>
    {/if}
  </div>
{/if}

<style>
  /* 태그 칩: --tag(태그 색)에서 바탕·글자색을 테마에 맞게 만든다 */
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 24px;
    padding: 0 6px 0 8px;
    border: 1px solid color-mix(in srgb, var(--tag, var(--text-faint)) 45%, transparent);
    border-radius: 999px;
    background: color-mix(in srgb, var(--tag, var(--text-faint)) 18%, var(--surface));
    color: color-mix(in srgb, var(--tag, var(--text-faint)) 60%, var(--text));
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
  }

  .chip.md {
    height: 28px;
    font-size: 13px;
  }

  .chip.empty {
    border-style: dashed;
    background: transparent;
    color: var(--text-muted);
    font-weight: 500;
  }

  button.chip:hover,
  .chip.open {
    border-color: var(--accent);
  }

  .chip :global(.chevron) {
    color: var(--text-faint);
  }

  .dot {
    flex: none;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--tag, var(--text-faint));
  }

  .dot.none {
    border: 1.5px dashed var(--text-faint);
    background: transparent;
  }

  .menu {
    position: fixed;
    z-index: 200;
    width: 264px;
    max-height: 420px;
    padding: 4px;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-family: var(--font);
    font-size: 13px;
    white-space: normal;
    box-shadow: 0 8px 28px rgb(20 15 5 / 16%), 0 2px 6px rgb(20 15 5 / 8%);
  }

  .menu.flip {
    transform: translateY(-100%);
  }

  .menu:focus {
    outline: none;
  }

  .option {
    display: flex;
    align-items: center;
    gap: 2px;
    border-radius: var(--radius-sm);
  }

  .option:hover {
    background: var(--surface-3);
  }

  .pick {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 8px;
    min-width: 0;
    padding: 7px 8px;
    border: 0;
    background: transparent;
    color: inherit;
    text-align: left;
  }

  .option.selected .pick {
    color: var(--accent);
  }

  .name {
    flex: 1;
    overflow: hidden;
    font-weight: 500;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .divider {
    height: 1px;
    margin: 4px 0;
    background: var(--border);
  }

  .add {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 7px 8px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--accent);
    font-weight: 500;
  }

  .add:hover {
    background: var(--accent-soft);
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 8px;
  }

  .form-title {
    margin: 0;
    font-weight: 600;
  }

  .swatches {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 6px;
  }

  .swatch {
    width: 100%;
    aspect-ratio: 1;
    max-width: 32px;
    padding: 0;
    border: 2px solid var(--surface);
    border-radius: 50%;
    background: var(--tag, transparent);
    box-shadow: 0 0 0 1px var(--border);
  }

  .swatch.on {
    box-shadow: 0 0 0 2px var(--text);
  }

  .hex {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .swatch.preview {
    flex: none;
    width: 22px;
  }

  .hex .input {
    flex: 1;
    min-width: 0;
    font-variant-numeric: tabular-nums;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .spacer {
    flex: 1;
  }
</style>
