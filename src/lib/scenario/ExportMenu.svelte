<script lang="ts">
  // 내보내기: 정리 결과를 텍스트 파일로, 분류한 그림을 폴더로 저장한다.
  import { chooseExportFolder, saveTextFile, writeExportFile } from "$lib/files";
  import { Download, FileDown, FolderDown, ImageIcon, LoaderCircle, Save, TriangleAlert } from "$lib/icons";
  import Switch from "$lib/ui/Switch.svelte";
  import { buildText, exportBaseName, imageFileName, imagePlaceholder } from "./export.svelte";
  import { formatSize, SAVE_EXTENSION, sessions } from "./session.svelte";
  import { scenario } from "./state.svelte";
  import type { ImageBlock } from "./types";

  let open = $state(false);
  let root = $state<HTMLDivElement>();
  let busy = $state<"text" | "images" | "save" | null>(null);
  let progress = $state(0);
  let message = $state<{ ok: boolean; text: string } | null>(null);

  // 직접 바꾸기 전까지는 「이름이 입력된 치환 규칙이 있으면 켜짐」을 따른다.
  let substituteChoice = $state<boolean | null>(null);
  const hasNames = $derived(scenario.rules.some((r) => r.label.trim() && r.name.trim()));
  const substitute = $derived(substituteChoice ?? hasNames);
  let notes = $state(false);
  let blankBeforeHeadings = $state(true);
  let speakers = $state(false);

  const images = $derived(
    scenario.sections.flatMap((s) => s.blocks.filter((b): b is ImageBlock => b.type === "image" && !!b.imageId && scenario.images.has(b.imageId))),
  );
  const firstImage = $derived(scenario.sections.flatMap((s) => s.blocks).find((b): b is ImageBlock => b.type === "image"));

  $effect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root?.contains(e.target as Node)) open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        open = false;
      }
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey, true);
    };
  });

  async function exportText() {
    busy = "text";
    message = null;
    try {
      const text = await buildText({ substitute, notes, blankBeforeHeadings, speakers });
      const path = await saveTextFile(`${exportBaseName()} (정리).txt`, text);
      if (path) message = { ok: true, text: `저장했습니다: ${path}` };
    } catch (e) {
      message = { ok: false, text: `저장하지 못했습니다: ${e}` };
    } finally {
      busy = null;
    }
  }

  async function exportSave() {
    busy = "save";
    message = null;
    try {
      const path = await sessions.exportFile();
      if (path) message = { ok: true, text: `세이브 파일을 저장했습니다: ${path}` };
    } catch (e) {
      message = { ok: false, text: `세이브 파일을 저장하지 못했습니다: ${e}` };
    } finally {
      busy = null;
    }
  }

  async function exportImages() {
    message = null;
    try {
      const folder = await chooseExportFolder();
      if (!folder) return;
      busy = "images";
      progress = 0;
      for (const block of images) {
        await writeExportFile(imageFileName(block), scenario.images.get(block.imageId!)!.url);
        progress++;
      }
      message = { ok: true, text: `그림 ${images.length}개를 저장했습니다: ${folder}` };
    } catch (e) {
      message = { ok: false, text: `그림을 저장하지 못했습니다 (${progress}/${images.length}): ${e}` };
    } finally {
      busy = null;
    }
  }
</script>

<div class="export" bind:this={root}>
  <button class="btn sm" class:on={open} onclick={() => (open = !open)} aria-expanded={open} title="텍스트 파일·그림으로 저장">
    <Download size={15} /> 내보내기
  </button>

  {#if open}
    <div class="panel" role="dialog" aria-label="내보내기">
      <section>
        <h3><FileDown size={15} /> 텍스트 파일</h3>
        <p class="hint">
          한 줄에 한 문장씩 저장합니다. 그림이 있던 자리는
          <code>{firstImage ? imagePlaceholder(firstImage) : "[그림 01 · 3쪽]"}</code>
          처럼 표시됩니다.
        </p>
        <div class="options">
          <Switch
            bind:checked={() => substitute, (v) => (substituteChoice = v)}
            label="이름 치환 적용"
            hint={hasNames ? "탐사자·PC 등을 캐릭터 이름으로, 조사도 맞춰서" : "이름 치환 패널에 캐릭터 이름을 넣으면 쓸 수 있어요"}
          />
          <Switch bind:checked={notes} label="GM 메모·정보 포함" hint="GM용으로 뽑을 때. 메모는 문장 아래 ※, GM 정보 그룹은 ※ GM: 로 표시 (끄면 둘 다 빠짐)" />
          <Switch bind:checked={speakers} label="대사 앞에 화자 붙이기" hint={'예: KPC: "가자."'} />
          <Switch bind:checked={blankBeforeHeadings} label="제목 앞에 빈 줄" />
        </div>
        {#if scenario.status === "processing"}
          <p class="warn"><TriangleAlert size={13} /> 아직 정리 중입니다. 지금 저장하면 정리된 부분까지만 들어갑니다.</p>
        {/if}
        <button class="btn primary" onclick={exportText} disabled={busy !== null || !scenario.sections.length}>
          {#if busy === "text"}<LoaderCircle size={14} class="spin" />{:else}<FileDown size={14} />{/if} 텍스트 파일로 저장…
        </button>
      </section>

      <section>
        <h3><ImageIcon size={15} /> 그림</h3>
        <p class="hint">
          {#if images.length}
            분류한 그림 {images.length}개를 고른 폴더에 저장합니다. 파일 이름은 텍스트의 표시와 같은 번호예요
            (<code>{imageFileName(images[0])}</code>). 그림 하나만 저장하려면 그림 위의 저장 버튼을 누르세요.
          {:else}
            저장할 그림이 없습니다.
          {/if}
        </p>
        <button class="btn" onclick={exportImages} disabled={busy !== null || !images.length}>
          {#if busy === "images"}
            <LoaderCircle size={14} class="spin" /> 저장 중 {progress}/{images.length}
          {:else}
            <FolderDown size={14} /> 그림 모두 저장…
          {/if}
        </button>
      </section>

      <section>
        <h3><Save size={15} /> 세이브 파일</h3>
        <p class="hint">
          작업은 상단 「저장」(⌘/Ctrl+S)으로 앱 안에 저장됩니다. 다른 컴퓨터로 옮기거나 따로 보관하려면 세이브 파일(<code>.{SAVE_EXTENSION}</code>)로 저장하세요.
          원본 PDF·그림은 넣지 않아 가볍습니다{sessions.size ? ` (지금 약 ${formatSize(sessions.size)})` : ""}. 열 때 원본 PDF를 다시 고르면 그림이 돌아옵니다.
        </p>
        <button class="btn" onclick={exportSave} disabled={busy !== null || !scenario.sections.length}>
          {#if busy === "save"}<LoaderCircle size={14} class="spin" />{:else}<Save size={14} />{/if} 세이브 파일로 저장…
        </button>
      </section>

      {#if message}
        <p class="message" class:error={!message.ok}>{message.text}</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .export {
    position: relative;
  }

  .btn.on {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
  }

  .panel {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    z-index: 60;
    display: flex;
    flex-direction: column;
    gap: 14px;
    width: 380px;
    padding: 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: 0 12px 32px rgb(20 15 5 / 18%), 0 2px 6px rgb(20 15 5 / 8%);
  }

  section {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }

  section + section {
    padding-top: 14px;
    border-top: 1px solid var(--border);
  }

  h3 {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    font-size: 14px;
  }

  h3 :global(svg) {
    color: var(--accent);
  }

  .hint {
    margin: 0;
    color: var(--text-muted);
    font-size: 12px;
    line-height: 1.6;
  }

  code {
    padding: 1px 5px;
    border-radius: 4px;
    background: var(--surface-3);
    color: var(--text);
    font-size: 11px;
  }

  .options {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .warn {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    color: var(--warn);
    font-size: 12px;
  }

  .message {
    margin: 0;
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    background: var(--ok-soft);
    color: var(--ok);
    font-size: 12px;
    overflow-wrap: anywhere;
  }

  .message.error {
    background: var(--danger-soft);
    color: var(--danger);
  }
</style>
