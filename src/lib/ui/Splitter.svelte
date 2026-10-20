<script lang="ts">
  // 두 패널 사이의 크기 조절 손잡이. 끌면 `size`(px)를 바꾼다.
  // `invert`: 크기를 바꿀 패널이 손잡이의 왼쪽(위쪽)에 있을 때 true (오른쪽·아래로 끌면 커진다).

  let {
    size = $bindable(),
    direction = "horizontal",
    invert = false,
    min = 240,
    max = 900,
    label = "패널 크기 조절",
  }: {
    size: number;
    direction?: "horizontal" | "vertical";
    invert?: boolean;
    min?: number;
    max?: number;
    label?: string;
  } = $props();

  let dragging = $state(false);

  function clamp(v: number) {
    return Math.round(Math.min(max, Math.max(min, v)));
  }

  function onPointerDown(e: PointerEvent) {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    dragging = true;
    const start = direction === "horizontal" ? e.clientX : e.clientY;
    const initial = size;
    const move = (ev: PointerEvent) => {
      const delta = (direction === "horizontal" ? ev.clientX : ev.clientY) - start;
      size = clamp(initial + (invert ? delta : -delta));
    };
    const up = () => {
      dragging = false;
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }

  function onKeydown(e: KeyboardEvent) {
    const step = e.shiftKey ? 64 : 16;
    const grow = direction === "horizontal" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
    const i = grow.indexOf(e.key);
    if (i < 0) return;
    e.preventDefault();
    const towardEnd = i === 1;
    size = clamp(size + (towardEnd === invert ? step : -step));
  }
</script>

<!-- 포커스 가능한 separator는 크기 조절 손잡이의 표준 ARIA 패턴이다 (키보드 ←→/↑↓로 조절). -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class="splitter {direction}"
  class:dragging
  role="separator"
  tabindex="0"
  aria-label={label}
  aria-orientation={direction === "horizontal" ? "vertical" : "horizontal"}
  aria-valuenow={size}
  aria-valuemin={min}
  aria-valuemax={max}
  title="끌어서 크기 조절"
  onpointerdown={onPointerDown}
  onkeydown={onKeydown}
>
  <span class="line"></span>
</div>

<style>
  .splitter {
    position: relative;
    z-index: 2;
    display: grid;
    place-items: center;
    background: transparent;
    touch-action: none;
  }

  .splitter.horizontal {
    width: 9px;
    height: 100%;
    margin: 0 -4px;
    cursor: col-resize;
  }

  .splitter.vertical {
    width: 100%;
    height: 9px;
    margin: -4px 0;
    cursor: row-resize;
  }

  .line {
    background: var(--border);
    transition: background 0.12s;
  }

  .horizontal .line {
    width: 1px;
    height: 100%;
  }

  .vertical .line {
    width: 100%;
    height: 1px;
  }

  .splitter:hover .line,
  .splitter.dragging .line,
  .splitter:focus-visible .line {
    background: var(--accent);
  }

  .horizontal:hover .line,
  .horizontal.dragging .line {
    width: 3px;
  }

  .vertical:hover .line,
  .vertical.dragging .line {
    height: 3px;
  }

  .splitter:focus-visible {
    outline: none;
  }
</style>
