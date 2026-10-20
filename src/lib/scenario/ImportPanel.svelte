<script lang="ts">
  import { ClipboardPaste, FileClock, FileText, FileUp, FolderOpen, Link, LoaderCircle, Settings2, TriangleAlert } from "$lib/icons";
  import { fetchGoogleDoc, isGoogleDocUrl } from "./gdocs";
  import ConfirmButton from "$lib/ui/ConfirmButton.svelte";
  import Switch from "$lib/ui/Switch.svelte";
  import { formatSize, isSaveFile, SAVE_EXTENSION, sessions, timeAgo } from "./session.svelte";
  import { scenario } from "./state.svelte";

  /** 이 화면이 실제로 보일 때만 창 전체에서 파일을 받는다 (다른 페이지에서 놓은 파일을 몰래 열지 않게). */
  let { active = true }: { active?: boolean } = $props();

  let pasting = $state(false);
  let pasted = $state("");
  let fileInput: HTMLInputElement;

  // 점선 상자뿐 아니라 화면 어디에 놓아도 받는다. 자식 요소를 오갈 때 생기는 dragleave를 세어서 표시를 유지한다.
  let depth = $state(0);
  const dragging = $derived(active && depth > 0);
  // 파일뿐 아니라 브라우저에서 끌어온 구글 문서 링크도 받는다.
  const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].some((t) => t === "Files" || t === "text/uri-list");

  // ── 구글 문서 링크로 가져오기 ──
  let linking = $state(false);
  let docUrl = $state("");
  let fetching = $state(false);

  async function importGoogleDoc(url: string) {
    openError = null;
    fetching = true;
    try {
      const doc = await fetchGoogleDoc(url);
      await scenario.loadText(`${doc.title} (구글 문서)`, doc.text, doc.id);
    } catch (e) {
      openError = e instanceof Error ? e.message : String(e);
    } finally {
      fetching = false;
    }
  }

  let saveInput: HTMLInputElement;
  let openError = $state<string | null>(null);

  // 이 화면이 보일 때마다 최근 작업 목록을 새로 읽는다.
  $effect(() => {
    if (active) sessions.refresh();
  });

  /** 시나리오(PDF·텍스트)면 정리를 시작하고, 세이브 파일이면 이어서 작업한다. */
  async function pick(files: FileList | null | undefined) {
    const file = files?.[0];
    if (!file) return;
    openError = null;
    try {
      if (isSaveFile(file)) await sessions.importFile(file);
      else await scenario.loadFile(file);
    } catch (e) {
      openError = e instanceof Error ? e.message : String(e);
    }
  }

  async function resume(id: string) {
    openError = null;
    try {
      await sessions.open(id);
    } catch (e) {
      openError = `작업을 열지 못했습니다: ${e instanceof Error ? e.message : e}`;
    }
  }

  function onWindowDragEnter(e: DragEvent) {
    if (active && hasFiles(e)) depth++;
  }

  function onWindowDragLeave(e: DragEvent) {
    if (active && hasFiles(e)) depth = Math.max(0, depth - 1);
  }

  function onWindowDrop(e: DragEvent) {
    depth = 0;
    if (!active) return;
    e.preventDefault();
    if (e.dataTransfer?.files.length) return pick(e.dataTransfer.files);
    const link = e.dataTransfer?.getData("text/uri-list") || e.dataTransfer?.getData("text/plain") || "";
    if (isGoogleDocUrl(link.split("\n")[0])) importGoogleDoc(link.split("\n")[0]);
  }

  /** 붙여넣은 내용이 구글 문서 링크 하나뿐이면 그 문서를 가져온다. */
  function submitPasted() {
    if (isGoogleDocUrl(pasted)) importGoogleDoc(pasted);
    else scenario.loadText("붙여넣은 텍스트", pasted);
  }

  const optionItems = [
    { key: "removePageNumbers", label: "쪽수 제거", hint: "여백의 12, - 12 -, 12 / 40, p.12 같은 쪽 번호를 지웁니다." },
    { key: "removeHeaders", label: "반복되는 머리글/바닥글 제거", hint: "여러 쪽에 같은 자리로 반복되는 제목 줄을 지웁니다 (PDF)." },
    { key: "splitOnEllipsis", label: "말줄임표 뒤에서 문장 나누기", hint: "끄면 말줄임표(…, ......)를 문장 끝으로 보지 않고 문장을 이어 둡니다." },
    { key: "joinLinesWithoutSpace", label: "줄바꿈을 항상 공백 없이 잇기", hint: "기본은 문서 속 단어를 보고 단어 중간에서 줄이 바뀌었는지 자동 판단합니다. 그래도 '초 상화'처럼 끊기면 켜세요." },
  ] as const;
</script>

<svelte:window ondragenter={onWindowDragEnter} ondragleave={onWindowDragLeave} ondrop={onWindowDrop} />

<div class="import">
  <div class="intro">
    <h1>시나리오 준비</h1>
    <p class="muted">
      PDF나 텍스트 시나리오를 문장 단위로 정리합니다. 대사와 그림은 따로 분류되고 쪽수는 지워집니다.
      직접 확인하고 고친 뒤에는 문장마다 바로 복사해 CCFOLIA나 Roll20에 붙여넣을 수 있습니다.
    </p>
  </div>

  <div
    class="drop"
    class:dragging
    role="button"
    tabindex="0"
    onclick={() => fileInput.click()}
    onkeydown={(e) => (e.key === "Enter" || e.key === " ") && fileInput.click()}
  >
    <FileUp size={36} strokeWidth={1.5} />
    <strong>{dragging ? "놓으면 바로 정리를 시작합니다" : "PDF·텍스트 파일이나 구글 문서 링크를 끌어다 놓거나, 클릭해서 여세요"}</strong>
    <span class="muted">.pdf · .txt · .md · 세이브 파일(.{SAVE_EXTENSION}) — 긴 시나리오는 몇 쪽씩 나눠 처리하므로 앞부분부터 바로 볼 수 있습니다.</span>
    <input bind:this={fileInput} type="file" accept=".pdf,.txt,.md,.text,.{SAVE_EXTENSION},application/pdf,text/plain" hidden onchange={(e) => pick(e.currentTarget.files)} />
  </div>

  <div class="paste">
    {#if pasting}
      <textarea class="paste-area" bind:value={pasted} placeholder="시나리오 텍스트를 붙여넣으세요"></textarea>
      <div class="row">
        <button class="btn ghost" onclick={() => (pasting = false)}>취소</button>
        <button class="btn primary" disabled={!pasted.trim()} onclick={submitPasted}>정리하기</button>
      </div>
    {:else if linking}
      <form
        class="link-form"
        onsubmit={(e) => {
          e.preventDefault();
          if (docUrl.trim()) importGoogleDoc(docUrl);
        }}
      >
        <input
          class="input link-input"
          bind:value={docUrl}
          placeholder="https://docs.google.com/document/d/…"
          aria-label="구글 문서 링크"
          disabled={fetching}
        />
        <button type="button" class="btn ghost" onclick={() => (linking = false)} disabled={fetching}>취소</button>
        <button type="submit" class="btn primary" disabled={!docUrl.trim() || fetching}>
          {#if fetching}<LoaderCircle size={14} class="spin" /> 가져오는 중{:else}가져오기{/if}
        </button>
      </form>
      <p class="link-hint muted">
        구글 문서에서 「공유 → 일반 액세스 → 링크가 있는 모든 사용자 (뷰어)」로 바꾼 뒤 링크를 붙여넣으세요. 로그인은 필요 없습니다.
        글자만 가져오며, 그림은 들어오지 않습니다.
      </p>
    {:else}
      <div class="row start">
        <button class="btn" onclick={() => (pasting = true)}><ClipboardPaste size={16} /> 텍스트 직접 붙여넣기</button>
        <button class="btn" onclick={() => (linking = true)}><Link size={16} /> 구글 문서 링크로 가져오기</button>
      </div>
    {/if}
  </div>

  {#if openError}
    <p class="open-error"><TriangleAlert size={14} /> {openError}</p>
  {/if}

  <section class="recent">
    <header>
      <h2><FileClock size={16} /> 최근 작업</h2>
      <button class="btn sm" onclick={() => saveInput.click()}><FolderOpen size={14} /> 세이브 파일 열기</button>
      <input bind:this={saveInput} type="file" accept=".{SAVE_EXTENSION},.json" hidden onchange={(e) => pick(e.currentTarget.files)} />
    </header>
    {#if sessions.list.length}
      <ul>
        {#each sessions.list as item (item.id)}
          <li>
            <button class="session" onclick={() => resume(item.id)} title="이어서 작업하기">
              <FileText size={18} />
              <span class="session-text">
                <strong>{item.name}</strong>
                <span class="muted">
                  {item.total}줄 · 집합 {item.sections}개{item.size ? ` · ${formatSize(item.size)}` : ""} · {timeAgo(item.updatedAt)}
                </span>
              </span>
            </button>
            <ConfirmButton title="이 작업 삭제 (두 번 눌러야 지워집니다)" onconfirm={() => sessions.remove(item.id)} />
          </li>
        {/each}
      </ul>
    {:else}
      <p class="muted empty">작업을 저장하면(⌘/Ctrl+S) 여기에서 이어서 할 수 있습니다.</p>
    {/if}
  </section>

  <fieldset class="options">
    <legend><Settings2 size={15} /> 정리 옵션</legend>
    {#each optionItems as item (item.key)}
      <Switch bind:checked={scenario.options[item.key]} label={item.label} hint={item.hint} />
    {/each}
  </fieldset>
</div>

<style>
  .import {
    display: flex;
    flex-direction: column;
    gap: 20px;
    max-width: 720px;
    margin: 0 auto;
    padding: 48px 24px;
  }

  h1 {
    margin: 0 0 6px;
    font-size: 22px;
  }

  .intro p {
    margin: 0;
  }

  .drop {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 40px 24px;
    border: 2px dashed var(--border-strong);
    border-radius: 14px;
    background: var(--surface);
    color: var(--text-muted);
    text-align: center;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
  }

  .drop strong {
    color: var(--text);
    font-size: 15px;
  }

  .drop:hover,
  .drop.dragging {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
  }

  .row.start {
    align-self: flex-start;
  }

  .link-form {
    display: flex;
    gap: 8px;
    width: 100%;
  }

  .link-input {
    flex: 1;
  }

  .link-hint {
    margin: 0;
    font-size: 12px;
    line-height: 1.6;
  }

  .open-error {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    color: var(--danger);
  }

  .recent {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .recent header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .recent h2 {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    font-size: 15px;
  }

  .recent h2 :global(svg) {
    color: var(--accent);
  }

  .recent ul {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .recent li {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .session {
    display: grid;
    grid-template-columns: auto 1fr;
    flex: 1;
    gap: 12px;
    align-items: center;
    min-width: 0;
    padding: 10px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    text-align: left;
  }

  .session:hover {
    border-color: var(--accent);
  }

  .session > :global(svg) {
    color: var(--text-muted);
  }

  .session-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .session-text strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .session-text .muted {
    font-size: 12px;
  }

  .empty {
    margin: 0;
    font-size: 13px;
  }

  .paste {
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: flex-start;
  }

  .paste-area {
    width: 100%;
    min-height: 200px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    resize: vertical;
  }

  .row {
    display: flex;
    gap: 8px;
    align-self: flex-end;
  }

  .options {
    display: flex;
    flex-direction: column;
    gap: 14px;
    margin: 0;
    padding: 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
  }

  legend {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 6px;
    font-weight: 600;
  }

</style>
