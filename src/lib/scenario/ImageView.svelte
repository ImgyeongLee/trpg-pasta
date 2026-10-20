<script lang="ts">
  import { saveImageFile } from "$lib/files";
  import { Check, Download, ImageIcon, TriangleAlert, X, ZoomIn } from "$lib/icons";
  import { imageFileName } from "./export.svelte";
  import { scenario } from "./state.svelte";
  import type { ImageBlock } from "./types";

  let {
    block,
    compact = false,
    zoomOnClick = true,
  }: {
    block: ImageBlock;
    compact?: boolean;
    /** false면 그림을 눌러도 확대하지 않고(카드 클릭 복사용), 확대 버튼을 따로 보여준다. */
    zoomOnClick?: boolean;
  } = $props();

  const image = $derived(block.imageId ? scenario.images.get(block.imageId) : undefined);
  const fileName = $derived(imageFileName(block));
  let zoomed = $state(false);
  let saved = $state<"ok" | "error" | null>(null);

  // 확대 중의 Esc는 여기서 먼저 처리해 복사 페이지가 함께 닫히지 않게 한다.
  $effect(() => {
    if (!zoomed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      zoomed = false;
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  async function download(e: MouseEvent) {
    e.stopPropagation();
    if (!image) return;
    try {
      const path = await saveImageFile(fileName, image.url);
      saved = path ? "ok" : null;
    } catch (err) {
      console.error(err);
      saved = "error";
    }
    if (saved) setTimeout(() => (saved = null), 1500);
  }
</script>

{#if image}
  <div class="wrap" class:compact>
    {#if zoomOnClick}
      <button class="thumb" onclick={() => (zoomed = true)} title="크게 보기" data-focus>
        <img src={image.url} alt={`${image.page}쪽 그림`} />
      </button>
    {:else}
      <div class="thumb static">
        <img src={image.url} alt={`${image.page}쪽 그림`} />
      </div>
    {/if}
    <div class="overlay">
      {#if !zoomOnClick}
        <button
          class="icon-btn"
          title="크게 보기"
          onclick={(e) => {
            e.stopPropagation();
            zoomed = true;
          }}><ZoomIn size={15} /></button
        >
      {/if}
      <button class="icon-btn" class:ok={saved === "ok"} class:bad={saved === "error"} title="그림 저장 ({fileName})" onclick={download}>
        {#if saved === "ok"}<Check size={15} />{:else if saved === "error"}<TriangleAlert size={15} />{:else}<Download size={15} />{/if}
      </button>
    </div>
  </div>
  {#if zoomed}
    <div class="lightbox" role="presentation" onclick={() => (zoomed = false)}>
      <img src={image.url} alt={`${image.page}쪽 그림`} />
      <button class="icon-btn close" aria-label="닫기"><X size={20} /></button>
    </div>
  {/if}
{:else}
  <div class="placeholder" data-focus tabindex="-1">
    <ImageIcon size={18} />
    <span>
      {#if block.imageId && scenario.missingPdf}
        {fileName.replace(/\.png$/, "")} — 원본 PDF를 연결하면 보입니다
      {:else}
        {block.caption ?? "그림"}
      {/if}
    </span>
  </div>
{/if}

<style>
  .wrap {
    position: relative;
    display: inline-block;
    max-width: 100%;
    vertical-align: top;
  }

  .thumb {
    display: block;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: repeating-conic-gradient(var(--surface-3) 0 25%, var(--surface) 0 50%) 50% / 16px 16px;
    overflow: hidden;
    cursor: zoom-in;
  }

  .thumb.static {
    cursor: inherit;
  }

  .thumb img {
    display: block;
    max-width: 100%;
    max-height: 260px;
    object-fit: contain;
  }

  .compact .thumb img {
    max-height: 120px;
  }

  .overlay {
    position: absolute;
    top: 6px;
    right: 6px;
    display: flex;
    gap: 4px;
    opacity: 0;
    transition: opacity 0.12s;
  }

  .wrap:hover .overlay,
  .overlay:focus-within {
    opacity: 1;
  }

  .overlay .icon-btn {
    background: var(--surface);
    box-shadow: var(--shadow);
  }

  .overlay .icon-btn.ok {
    color: var(--ok);
  }

  .overlay .icon-btn.bad {
    color: var(--danger);
  }

  .placeholder {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius-sm);
    color: var(--text-muted);
  }

  .lightbox {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    place-items: center;
    padding: 32px;
    background: rgb(0 0 0 / 75%);
    cursor: zoom-out;
  }

  .lightbox img {
    max-width: 100%;
    max-height: 100%;
    border-radius: var(--radius-sm);
    background: #fff;
  }

  .close {
    position: absolute;
    top: 16px;
    right: 16px;
    color: #fff;
  }
</style>
