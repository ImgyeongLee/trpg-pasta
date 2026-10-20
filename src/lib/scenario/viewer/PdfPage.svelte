<script lang="ts">
  import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist/legacy/build/pdf.mjs";
  import type { Rect } from "./match";

  let {
    doc,
    pageNumber,
    size,
    width,
    root,
    highlight = [],
    onpick,
    cropping = false,
    oncrop,
  }: {
    doc: PDFDocumentProxy;
    pageNumber: number;
    /** 배율 1일 때 쪽 크기 (pt) */
    size: { w: number; h: number };
    /** 화면에 그릴 너비 (CSS px) */
    width: number;
    /** 화면에 보일 때만 그리기 위한 스크롤 영역 */
    root: HTMLElement | undefined;
    /** 강조할 영역 (배율 1 좌표) */
    highlight?: Rect[];
    /** 쪽을 눌렀을 때 (배율 1 좌표) */
    onpick: (page: number, x: number, y: number) => void;
    /** 「그림 자르기」 중이면 누르는 대신 사각형을 끌어 고른다 */
    cropping?: boolean;
    /** 사각형을 다 끌었을 때 (배율 1 좌표) */
    oncrop?: (page: number, rect: Rect) => void;
  } = $props();

  const scale = $derived(width / size.w);
  const height = $derived(size.h * scale);

  let el = $state<HTMLDivElement>();
  let canvas = $state<HTMLCanvasElement>();
  let visible = $state(false);
  let renderedWidth = 0;
  let task: RenderTask | null = null;

  // 화면 근처에 왔을 때만 그린다 (긴 PDF도 가볍게).
  $effect(() => {
    if (!el || !root) return;
    const io = new IntersectionObserver(([entry]) => (visible = entry.isIntersecting), { root, rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  });

  $effect(() => {
    const target = width;
    if (!visible || !canvas || target === renderedWidth) return;
    let cancelled = false;
    (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled) return;
      const ratio = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: (target / size.w) * ratio });
      // 확대·축소 중 깜빡이지 않도록 다른 캔버스에 그린 뒤 옮긴다.
      const off = document.createElement("canvas");
      off.width = Math.ceil(viewport.width);
      off.height = Math.ceil(viewport.height);
      const ctx = off.getContext("2d");
      if (!ctx) return;
      task?.cancel();
      task = page.render({ canvas: off, canvasContext: ctx, viewport });
      try {
        await task.promise;
      } catch {
        return; // 더 새로운 그리기로 취소됨
      }
      if (cancelled || !canvas) return;
      canvas.width = off.width;
      canvas.height = off.height;
      canvas.getContext("2d")?.drawImage(off, 0, 0);
      off.width = off.height = 0;
      renderedWidth = target;
    })();
    return () => {
      cancelled = true;
    };
  });

  // ── 그림 자르기: 끌어서 사각형 고르기 (배율 1 좌표) ──
  let drag = $state<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const dragRect = $derived(
    drag && { x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1), w: Math.abs(drag.x1 - drag.x0), h: Math.abs(drag.y1 - drag.y0) },
  );

  function pointAt(e: PointerEvent) {
    const box = el!.getBoundingClientRect();
    const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));
    return { x: clamp((e.clientX - box.left) / scale, size.w), y: clamp((e.clientY - box.top) / scale, size.h) };
  }

  function onpointerdown(e: PointerEvent) {
    if (!cropping || e.button !== 0) return;
    e.preventDefault();
    el!.setPointerCapture(e.pointerId);
    const p = pointAt(e);
    drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
  }

  function onpointermove(e: PointerEvent) {
    if (!drag) return;
    const p = pointAt(e);
    drag = { ...drag, x1: p.x, y1: p.y };
  }

  function onpointerup() {
    const r = dragRect;
    drag = null;
    // 화면에서 8px보다 작게 끈 것은 실수로 누른 것으로 본다.
    if (r && r.w * scale >= 8 && r.h * scale >= 8) oncrop?.(pageNumber, r);
  }

  function onclick(e: MouseEvent) {
    if (cropping) return;
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    onpick(pageNumber, (e.clientX - box.left) / scale, (e.clientY - box.top) / scale);
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
  class="page"
  class:cropping
  bind:this={el}
  data-page={pageNumber}
  style:width="{width}px"
  style:height="{height}px"
  {onclick}
  {onpointerdown}
  {onpointermove}
  {onpointerup}
  onpointercancel={() => (drag = null)}
  title={cropping ? "그림으로 넣을 영역을 끌어서 고르세요" : "누르면 이 부분의 문장으로 이동"}
>
  <canvas bind:this={canvas}></canvas>
  {#each highlight as r, i (i)}
    <span class="mark" style:left="{r.x * scale - 2}px" style:top="{r.y * scale - 2}px" style:width="{r.w * scale + 4}px" style:height="{r.h * scale + 4}px"
    ></span>
  {/each}
  {#if dragRect}
    <span class="crop" style:left="{dragRect.x * scale}px" style:top="{dragRect.y * scale}px" style:width="{dragRect.w * scale}px" style:height="{dragRect.h * scale}px"
    ></span>
  {/if}
  <span class="no">{pageNumber}</span>
</div>

<style>
  .page {
    position: relative;
    margin: 0 auto;
    background: #fff;
    box-shadow: 0 1px 3px rgb(0 0 0 / 18%), 0 6px 18px rgb(0 0 0 / 8%);
    cursor: pointer;
  }

  .page.cropping {
    cursor: crosshair;
    touch-action: none;
    user-select: none;
  }

  .crop {
    position: absolute;
    border: 2px solid var(--accent);
    border-radius: 2px;
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    box-shadow: 0 0 0 9999px rgb(0 0 0 / 22%);
    pointer-events: none;
  }

  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  .mark {
    position: absolute;
    border-radius: 3px;
    background: rgb(255 214 0 / 38%);
    box-shadow: 0 0 0 2px rgb(255 170 0 / 65%);
    mix-blend-mode: multiply;
    pointer-events: none;
    animation: pulse 1.2s ease-out 1;
  }

  .no {
    position: absolute;
    right: 6px;
    bottom: 4px;
    padding: 0 5px;
    border-radius: 4px;
    background: rgb(0 0 0 / 45%);
    color: #fff;
    font-size: 10px;
    pointer-events: none;
  }

  @keyframes pulse {
    from {
      box-shadow: 0 0 0 8px rgb(255 170 0 / 0%);
    }
  }
</style>
