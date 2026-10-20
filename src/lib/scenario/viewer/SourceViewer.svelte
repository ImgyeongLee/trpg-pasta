<script lang="ts">
  // 원본 보기 패널: 정리 결과와 원본(PDF/텍스트)을 나란히 놓고 비교하며 고친다.
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { ArrowLeftRight, BookOpenText, ExternalLink, Link2, X } from "$lib/icons";
  import { layout } from "$lib/layout.svelte";
  import Switch from "$lib/ui/Switch.svelte";
  import { scenario } from "../state.svelte";
  import { googleDocUrl } from "../gdocs";
  import GdocViewer from "./GdocViewer.svelte";
  import PdfViewer from "./PdfViewer.svelte";
  import TextViewer from "./TextViewer.svelte";

  const gdocId = $derived(scenario.source?.kind === "text" ? scenario.source.gdocId : undefined);
  /** 구글 문서에서 가져온 경우: 구글 문서 모양(PDF)으로 볼지, 가져온 글자로 볼지 */
  let mode = $state<"gdoc" | "text">("gdoc");
</script>

<aside class="viewer" aria-label="원본 보기">
  <header>
    <span class="title"><BookOpenText size={15} /> 원본</span>
    <span class="name muted" title={scenario.sourceName}>{scenario.sourceName}</span>
    <span class="sync" title="목록에서 줄을 고르면 원본의 그 위치로, 원본을 누르면 목록의 그 줄로 이동합니다">
      <Switch size="sm" bind:checked={layout.viewerSync}><Link2 size={13} /> 연동</Switch>
    </span>
    {#if gdocId}
      <button class="icon-btn" onclick={() => openUrl(googleDocUrl(gdocId))} title="구글 문서를 브라우저에서 열기">
        <ExternalLink size={15} />
      </button>
    {/if}
    <button
      class="icon-btn"
      onclick={() => (layout.viewerSide = layout.viewerSide === "right" ? "left" : "right")}
      title="원본을 목록의 {layout.viewerSide === 'right' ? '왼쪽' : '오른쪽'}으로 옮기기"
    >
      <ArrowLeftRight size={15} />
    </button>
    <button class="icon-btn" onclick={() => (layout.viewerOpen = false)} title="원본 닫기"><X size={16} /></button>
  </header>

  {#if gdocId}
    <div class="modes" role="tablist" aria-label="원본 보기 방식">
      <button role="tab" class:active={mode === "gdoc"} aria-selected={mode === "gdoc"} onclick={() => (mode = "gdoc")}>구글 문서</button>
      <button role="tab" class:active={mode === "text"} aria-selected={mode === "text"} onclick={() => (mode = "text")}>텍스트</button>
    </div>
  {/if}

  {#key scenario.source}
    {#if gdocId && mode === "gdoc"}
      <GdocViewer id={gdocId} />
    {:else if scenario.source?.kind === "pdf"}
      <PdfViewer bytes={scenario.source.bytes} />
    {:else if scenario.source?.kind === "text"}
      <TextViewer text={scenario.source.text} />
    {:else}
      <p class="muted empty">원본이 없습니다.</p>
    {/if}
  {/key}
</aside>

<style>
  .viewer {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
    background: var(--surface);
  }

  header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
  }

  .title {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: none;
    font-weight: 600;
  }

  .title :global(svg) {
    color: var(--accent);
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sync {
    flex: none;
    margin-right: 4px;
  }

  .modes {
    display: flex;
    gap: 2px;
    margin: 6px 10px 0;
    padding: 3px;
    border-radius: var(--radius-sm);
    background: var(--surface-3);
  }

  .modes button {
    flex: 1;
    height: 26px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--text-muted);
    font-size: 12px;
  }

  .modes button.active {
    background: var(--surface);
    color: var(--text);
    font-weight: 600;
    box-shadow: var(--shadow);
  }

  .empty {
    padding: 40px 16px;
    text-align: center;
  }
</style>
