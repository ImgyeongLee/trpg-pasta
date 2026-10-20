<script lang="ts" generics="T extends string">
  import { Check, ChevronDown } from "$lib/icons";
  import type { SelectOption } from "./select";

  let {
    value = $bindable(),
    options,
    label,
    size = "md",
    onchange,
  }: {
    value: T;
    options: SelectOption<T>[];
    /** 접근성용 이름 */
    label: string;
    size?: "sm" | "md";
    onchange?: (value: T) => void;
  } = $props();

  let open = $state(false);
  let active = $state(0);
  let trigger = $state<HTMLButtonElement>();
  let menu = $state<HTMLDivElement>();
  let position = $state({ top: 0, left: 0, minWidth: 0, flip: false });

  const id = `select-${Math.random().toString(36).slice(2, 9)}`;
  const current = $derived(options.find((o) => o.value === value) ?? options[0]);

  // 목록 안(스크롤 영역)에서도 잘리지 않도록 화면 기준(fixed)으로 띄운다.
  function place() {
    if (!trigger) return;
    const r = trigger.getBoundingClientRect();
    const estimated = Math.min(320, options.length * 52 + 12);
    const flip = r.bottom + estimated > window.innerHeight - 8 && r.top > estimated;
    position = { top: flip ? r.top - 6 : r.bottom + 6, left: r.left, minWidth: r.width, flip };
  }

  function show() {
    place();
    active = Math.max(0, options.findIndex((o) => o.value === value));
    open = true;
  }

  function close(focusTrigger = true) {
    open = false;
    if (focusTrigger) trigger?.focus();
  }

  function choose(option: SelectOption<T>) {
    if (option.value !== value) {
      value = option.value;
      onchange?.(option.value);
    }
    close();
  }

  function onTriggerKeydown(e: KeyboardEvent) {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
      e.preventDefault();
      show();
    }
  }

  function onMenuKeydown(e: KeyboardEvent) {
    if (e.key === "ArrowDown") active = (active + 1) % options.length;
    else if (e.key === "ArrowUp") active = (active - 1 + options.length) % options.length;
    else if (e.key === "Home") active = 0;
    else if (e.key === "End") active = options.length - 1;
    else if (e.key === "Enter" || e.key === " ") choose(options[active]);
    else if (e.key === "Escape" || e.key === "Tab") close(e.key === "Escape");
    else return;
    e.preventDefault();
  }

  $effect(() => {
    if (!open) return;
    menu?.focus();
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!menu?.contains(target) && !trigger?.contains(target)) close(false);
    };
    const onScroll = (e: Event) => {
      if (!menu?.contains(e.target as Node)) close(false);
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
    };
  });
</script>

<button
  bind:this={trigger}
  type="button"
  class="trigger {size}"
  class:open
  aria-haspopup="listbox"
  aria-expanded={open}
  aria-controls={id}
  aria-label={label}
  title={label}
  onclick={() => (open ? close() : show())}
  onkeydown={onTriggerKeydown}
>
  {#if current?.icon}<current.icon size={size === "sm" ? 13 : 15} />{/if}
  <span class="value">{current?.label}</span>
  <ChevronDown size={size === "sm" ? 13 : 15} class="chevron" />
</button>

{#if open}
  <div
    bind:this={menu}
    {id}
    class="menu"
    class:flip={position.flip}
    role="listbox"
    tabindex="-1"
    aria-label={label}
    aria-activedescendant="{id}-{active}"
    style:top="{position.top}px"
    style:left="{position.left}px"
    style:min-width="{position.minWidth}px"
    onkeydown={onMenuKeydown}
  >
    {#each options as option, i (option.value)}
      <div
        id="{id}-{i}"
        class="option"
        class:active={i === active}
        class:selected={option.value === value}
        role="option"
        tabindex="-1"
        aria-selected={option.value === value}
        onpointerenter={() => (active = i)}
        onclick={() => choose(option)}
        onkeydown={() => {}}
      >
        <span class="icon">
          {#if option.icon}<option.icon size={15} />{/if}
        </span>
        <span class="text">
          <span class="option-label">{option.label}</span>
          {#if option.hint}<span class="hint">{option.hint}</span>{/if}
        </span>
        <span class="check">
          {#if option.value === value}<Check size={14} />{/if}
        </span>
      </div>
    {/each}
  </div>
{/if}

<style>
  .trigger {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 8px 0 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    white-space: nowrap;
    transition: border-color 0.12s, box-shadow 0.12s, background 0.12s;
  }

  .trigger.sm {
    height: 26px;
    padding: 0 6px 0 8px;
    gap: 4px;
    font-size: 12px;
  }

  .trigger:hover {
    border-color: var(--border-strong);
    background: var(--surface-2);
  }

  .trigger.open,
  .trigger:focus-visible {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .value {
    flex: 1;
    text-align: left;
  }

  .trigger :global(.chevron) {
    color: var(--text-faint);
    transition: transform 0.15s;
  }

  .trigger.open :global(.chevron) {
    transform: rotate(180deg);
  }

  .menu {
    position: fixed;
    z-index: 100;
    max-height: 320px;
    padding: 4px;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: 0 8px 28px rgb(20 15 5 / 16%), 0 2px 6px rgb(20 15 5 / 8%);
    animation: pop 0.12s ease-out;
  }

  .menu.flip {
    transform: translateY(-100%);
    animation-name: pop-up;
  }

  .menu:focus {
    outline: none;
  }

  .option {
    display: grid;
    grid-template-columns: 18px 1fr 16px;
    gap: 8px;
    align-items: center;
    padding: 7px 8px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    user-select: none;
  }

  .option.active {
    background: var(--surface-3);
  }

  .option.selected {
    color: var(--accent);
  }

  .icon,
  .check {
    display: grid;
    place-items: center;
  }

  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .option-label {
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
  }

  .hint {
    color: var(--text-muted);
    font-size: 11px;
    white-space: nowrap;
  }

  @keyframes pop {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
  }

  @keyframes pop-up {
    from {
      opacity: 0;
      transform: translateY(calc(-100% + 4px));
    }
  }
</style>
