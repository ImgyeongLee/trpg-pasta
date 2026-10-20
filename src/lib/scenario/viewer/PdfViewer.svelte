<script lang="ts">
  import { untrack } from "svelte";
  import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
  import { ChevronLeft, ChevronRight, Crop, LoaderCircle, Maximize2, ZoomIn, ZoomOut } from "$lib/icons";
  import { layout } from "$lib/layout.svelte";
  import { focusBlock } from "../focus";
  import { cropRegion, openPdf, type OpenedPdf } from "../pdf";
  import { scenario } from "../state.svelte";
  import { sentenceRects, snippetAt, squash, type Piece, type Rect } from "./match";
  import PdfPage from "./PdfPage.svelte";
  import { aroundClick, jumpToSnippet } from "./sync";

  let {
    bytes,
    findByText = false,
  }: {
    bytes: Uint8Array;
    /**
     * 줄에 쪽 번호가 없을 때(구글 문서처럼 텍스트로 정리한 경우) 문장 글자로 쪽을 찾아간다.
     * 원본 → 목록 연동도 쪽 대신 글자만으로 찾는다.
     */
    findByText?: boolean;
  } = $props();

  const GAP = 12;
  const PAD = 12;

  let opened = $state.raw<OpenedPdf | null>(null);
  let failed = $state<string | null>(null);
  let sizes = $state<{ w: number; h: number }[]>([]);
  let scroller = $state<HTMLDivElement>();
  let clientWidth = $state(0);
  let zoom = $state(1);
  let current = $state(1);
  /** 쪽 번호 → 강조 영역 (문장이 다음 쪽으로 이어지면 두 쪽에 걸친다) */
  let highlight = $state<Record<number, Rect[]>>({});

  const total = $derived(sizes.length);
  const width = $derived(Math.max(160, Math.floor((clientWidth - PAD * 2) * zoom)));
  /** 각 쪽의 위쪽 위치 (스크롤 계산용) */
  const tops = $derived.by(() => {
    let y = PAD;
    return sizes.map((s) => {
      const top = y;
      y += s.h * (width / s.w) + GAP;
      return top;
    });
  });

  // ── 문서 열기 ──
  const pieceCache = new Map<number, Promise<Piece[]>>();

  $effect(() => {
    const data = bytes;
    let cancelled = false;
    let mine: OpenedPdf | null = null;
    (async () => {
      try {
        mine = await openPdf(data.slice().buffer);
        if (cancelled) return mine.close();
        opened = mine;
        const doc = mine.doc;
        const first = (await doc.getPage(1)).getViewport({ scale: 1 });
        sizes = Array.from({ length: doc.numPages }, () => ({ w: first.width, h: first.height }));
        // 쪽마다 크기가 다를 수 있으니 뒤에서 차례로 맞춘다.
        for (let n = 2; n <= doc.numPages && !cancelled; n++) {
          const vp = (await doc.getPage(n)).getViewport({ scale: 1 });
          if (vp.width !== first.width || vp.height !== first.height) sizes[n - 1] = { w: vp.width, h: vp.height };
        }
      } catch (e) {
        if (!cancelled) failed = e instanceof Error ? e.message : String(e);
      }
    })();
    return () => {
      cancelled = true;
      pieceCache.clear();
      opened = null;
      mine?.close();
    };
  });

  function piecesOf(n: number): Promise<Piece[]> {
    let cached = pieceCache.get(n);
    if (!cached && opened) {
      const doc = opened.doc;
      cached = (async () => {
        const page = await doc.getPage(n);
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        const out: Piece[] = [];
        for (const item of content.items) {
          if (!("str" in item) || !item.str.trim()) continue;
          const tx = pdfjs.Util.transform(viewport.transform, item.transform);
          const h = Math.hypot(tx[2], tx[3]);
          out.push({ str: item.str, rect: { x: tx[4], y: tx[5] - h, w: item.width, h: h * 1.15 } });
        }
        return out;
      })();
      pieceCache.set(n, cached);
    }
    return cached ?? Promise.resolve([]);
  }

  // ── 이동 ──
  function scrollTo(y: number, smooth = true) {
    scroller?.scrollTo({ top: Math.max(0, y), behavior: smooth ? "smooth" : "auto" });
  }

  function goTo(page: number) {
    const n = Math.min(Math.max(1, page), total);
    if (n) scrollTo(tops[n - 1] - PAD, false);
  }

  /**
   * 쪽으로 가서 문장을 형광펜으로 표시한다.
   * 문장이 쪽 끝에서 잘렸으면 다음 쪽 첫머리에서 나머지를 이어 칠한다.
   * 앞 집합에서 넘어온 문장은 다음 쪽에서 시작할 수도 있어 그 쪽도 찾아본다.
   */
  async function reveal(page: number | null, sentence: string, scroll = true) {
    const marks: Record<number, Rect[]> = {};
    let first: { page: number; y: number } | null = null;
    if (sentence) {
      const target = squash(sentence);
      // 쪽을 모르면 지금 보는 쪽부터 끝까지, 그다음 앞쪽을 차례로 찾는다.
      const candidates =
        page !== null
          ? [page, page + 1]
          : [...Array.from({ length: total - current + 1 }, (_, i) => current + i), ...Array.from({ length: current - 1 }, (_, i) => i + 1)];
      for (const candidate of candidates) {
        if (candidate > total) break;
        const hit = sentenceRects(await piecesOf(candidate), sentence);
        if (!hit.rects.length) continue;
        marks[candidate] = hit.rects;
        first = { page: candidate, y: hit.rects[0].y };
        const rest = target.slice(hit.consumed);
        if (rest.length >= 2 && candidate < total) {
          const next = sentenceRects(await piecesOf(candidate + 1), rest, true);
          if (next.rects.length) marks[candidate + 1] = next.rects;
        }
        break;
      }
    }
    highlight = marks;
    if (!scroll || !total) return;
    if (first) scrollTo(tops[first.page - 1] + first.y * (width / sizes[first.page - 1].w) - (scroller?.clientHeight ?? 0) / 3);
    else if (page !== null) scrollTo(tops[page - 1] - PAD);
  }

  // ── 목록 → 원본 연동 ──
  let fromViewer = false;

  $effect(() => {
    const id = scenario.focusedId;
    if (!layout.viewerSync || !opened || !total || id === null) return;
    untrack(() => {
      const found = scenario.find(id);
      if (!found) return;
      const page = found.block.page ?? null;
      if (page === null && !(findByText && found.block.type === "sentence")) return;
      reveal(page, found.block.type === "sentence" ? found.block.text : "", !fromViewer);
      fromViewer = false;
    });
  });

  // 집합을 바꾸면 그 집합의 첫 쪽으로 (그 집합 안의 줄을 보고 있지 않을 때)
  $effect(() => {
    const index = scenario.activeIndex;
    const section = scenario.sections[index];
    if (!layout.viewerSync || !opened || !total || !section) return;
    if (section.range.unit !== "쪽" && !findByText) return;
    untrack(() => {
      const focused = scenario.focusedId !== null ? scenario.find(scenario.focusedId) : null;
      if (focused?.sectionIndex === index) return;
      highlight = {};
      if (section.range.unit === "쪽") return goTo(section.range.from);
      // 텍스트로 정리한 집합: 첫 문장을 찾아 그 자리로
      const firstSentence = section.blocks.find((b) => b.type === "sentence" && b.text.trim().length >= 2);
      if (firstSentence?.type === "sentence") reveal(null, firstSentence.text);
    });
  });

  // ── 원본 → 목록 연동 ──
  async function pick(page: number, x: number, y: number) {
    const snippet = snippetAt(await piecesOf(page), x, y);
    if (!snippet) return;
    fromViewer = true;
    const ok = jumpToSnippet(aroundClick(snippet), (_, block) => findByText || block.page === page || block.page === page - 1);
    if (!ok) fromViewer = false;
  }

  function onscroll() {
    if (!scroller || !tops.length) return;
    const y = scroller.scrollTop + scroller.clientHeight * 0.3;
    let lo = 0;
    let hi = tops.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (tops[mid] <= y) lo = mid;
      else hi = mid - 1;
    }
    current = lo + 1;
  }

  // ── 그림 자르기 ──
  // 구글 문서를 PDF로 바꿔 보여줄 때는 세이브에서 다시 자를 원본이 없어 끈다.
  const canCrop = $derived(!findByText);
  let cropping = $state(false);
  let cropBusy = $state(false);

  async function crop(page: number, rect: Rect) {
    if (!opened || cropBusy) return;
    cropBusy = true;
    try {
      const image = await cropRegion(opened.doc, page, rect);
      const id = image && scenario.addImage(image);
      if (id != null) {
        cropping = false;
        focusBlock(id);
      }
    } finally {
      cropBusy = false;
    }
  }

  function onkeydown(e: KeyboardEvent) {
    if (cropping && e.key === "Escape") {
      e.preventDefault();
      cropping = false;
    }
  }

  function setZoom(z: number) {
    if (!scroller) return;
    // 보고 있던 위치를 유지한 채 배율을 바꾼다.
    const ratio = scroller.scrollTop / Math.max(1, scroller.scrollHeight);
    zoom = Math.min(3, Math.max(0.5, Math.round(z * 100) / 100));
    requestAnimationFrame(() => scroller && (scroller.scrollTop = ratio * scroller.scrollHeight));
  }
</script>

<svelte:window {onkeydown} />

<div class="toolbar">
  <div class="group">
    <button class="icon-btn" onclick={() => goTo(current - 1)} disabled={current <= 1} title="이전 쪽"><ChevronLeft size={16} /></button>
    <input
      class="input page-input"
      type="number"
      min="1"
      max={total}
      value={current}
      aria-label="쪽 번호"
      onchange={(e) => goTo(Number(e.currentTarget.value))}
    />
    <span class="muted">/ {total || "–"}</span>
    <button class="icon-btn" onclick={() => goTo(current + 1)} disabled={current >= total} title="다음 쪽"><ChevronRight size={16} /></button>
  </div>
  <div class="group">
    <button class="icon-btn" onclick={() => setZoom(zoom - 0.15)} disabled={zoom <= 0.5} title="축소"><ZoomOut size={16} /></button>
    <span class="zoom">{Math.round(zoom * 100)}%</span>
    <button class="icon-btn" onclick={() => setZoom(zoom + 0.15)} disabled={zoom >= 3} title="확대"><ZoomIn size={16} /></button>
    <button class="icon-btn" onclick={() => setZoom(1)} title="폭에 맞추기"><Maximize2 size={15} /></button>
    {#if canCrop}
      <button
        class="icon-btn crop-toggle"
        class:on={cropping}
        aria-pressed={cropping}
        onclick={() => (cropping = !cropping)}
        disabled={!scenario.active}
        title="그림 자르기 — 원본에서 영역을 끌어 현재 줄 뒤에 그림으로 넣기"
      >
        <Crop size={15} />
      </button>
    {/if}
  </div>
</div>

{#if cropping}
  <div class="crop-hint">
    {#if cropBusy}
      <LoaderCircle size={13} class="spin" /> 그림을 자르는 중…
    {:else}
      <Crop size={13} /> 그림으로 넣을 영역을 끌어서 고르세요. 현재 줄 뒤에 들어갑니다.
    {/if}
    <button class="btn-link" onclick={() => (cropping = false)}>취소 (Esc)</button>
  </div>
{/if}

<div class="scroller" bind:this={scroller} bind:clientWidth {onscroll}>
  {#if failed}
    <p class="state error">PDF를 열지 못했습니다: {failed}</p>
  {:else if !opened || !total}
    <p class="state muted"><LoaderCircle size={16} class="spin" /> 원본을 여는 중…</p>
  {:else}
    <div class="pages" style:padding="{PAD}px" style:gap="{GAP}px">
      {#each sizes as size, i (i)}
        <PdfPage
          doc={opened.doc}
          pageNumber={i + 1}
          {size}
          {width}
          root={scroller}
          highlight={highlight[i + 1] ?? []}
          onpick={pick}
          {cropping}
          oncrop={crop}
        />
      {/each}
    </div>
  {/if}
</div>

<style>
  .toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
  }

  .group {
    display: flex;
    align-items: center;
    gap: 2px;
    font-size: 12px;
  }

  .crop-toggle.on {
    background: var(--accent-soft);
    color: var(--accent);
  }

  .crop-hint {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    border-bottom: 1px solid var(--border);
    background: var(--accent-soft);
    color: var(--text);
    font-size: 12px;
  }

  .crop-hint .btn-link {
    margin-left: auto;
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
  }

  .page-input {
    width: 52px;
    height: 26px;
    padding: 0 6px;
    font-size: 12px;
    text-align: center;
    appearance: textfield;
  }

  .page-input::-webkit-inner-spin-button,
  .page-input::-webkit-outer-spin-button {
    appearance: none;
  }

  .zoom {
    min-width: 40px;
    color: var(--text-muted);
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  .scroller {
    flex: 1;
    min-height: 0;
    overflow: auto;
    background: var(--surface-3);
  }

  .pages {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: max-content;
    min-width: 100%;
  }

  .state {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 40px 16px;
  }

  .error {
    color: var(--danger);
  }
</style>
