<script lang="ts">
  // 구글 문서를 PDF로 받아 원본 그대로(서식·그림 포함) 보여준다. 목록과의 연동은 글자로 위치를 찾는다.
  import { LoaderCircle, RotateCcw, TriangleAlert } from "$lib/icons";
  import { fetchGoogleDocPdf } from "../gdocs";
  import PdfViewer from "./PdfViewer.svelte";

  let { id }: { id: string } = $props();

  let bytes = $state.raw<Uint8Array | null>(null);
  let error = $state<string | null>(null);
  let attempt = $state(0);

  $effect(() => {
    void attempt;
    let cancelled = false;
    bytes = null;
    error = null;
    fetchGoogleDocPdf(id).then(
      (b) => !cancelled && (bytes = b),
      (e) => !cancelled && (error = String(e)),
    );
    return () => {
      cancelled = true;
    };
  });
</script>

{#if bytes}
  <PdfViewer {bytes} findByText />
{:else if error}
  <div class="state">
    <p class="error"><TriangleAlert size={16} /> {error}</p>
    <button class="btn sm" onclick={() => attempt++}><RotateCcw size={14} /> 다시 시도</button>
  </div>
{:else}
  <p class="state muted"><LoaderCircle size={16} class="spin" /> 구글 문서를 받는 중…</p>
{/if}

<style>
  .state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 40px 16px;
    text-align: center;
  }

  p.state {
    flex-direction: row;
    justify-content: center;
    margin: 0;
  }

  .error {
    display: flex;
    gap: 6px;
    margin: 0;
    color: var(--danger);
    line-height: 1.6;
  }
</style>
