<script lang="ts">
  import {
    ArrowLeftRight,
    BookKey,
    BookOpenText,
    Eye,
    FileText,
    FolderOpen,
    Link,
    ListChecks,
    LoaderCircle,
    PanelLeftClose,
    PanelLeftOpen,
    PanelRightClose,
    PanelRightOpen,
    Pencil,
    Play,
    RotateCcw,
    Save,
    Trash,
    TriangleAlert,
    Undo2,
    X,
  } from "$lib/icons";
  import { layout } from "$lib/layout.svelte";
  import Splitter from "$lib/ui/Splitter.svelte";
  import Switch from "$lib/ui/Switch.svelte";
  import SourceViewer from "./viewer/SourceViewer.svelte";
  import { tick, untrack } from "svelte";
  import ExportMenu from "./ExportMenu.svelte";
  import { askUnsaved, sessions, timeAgo } from "./session.svelte";
  import ImportPanel from "./ImportPanel.svelte";
  import { editor } from "./editor/api.svelte";
  import LineBar from "./editor/LineBar.svelte";
  import SectionEditor from "./editor/SectionEditor.svelte";
  import RulesPanel from "./RulesPanel.svelte";
  import SectionList from "./SectionList.svelte";
  import { matchesFilter, save, scenario, type Filter } from "./state.svelte";

  let {
    active = true,
    onopencopy,
  }: {
    /** 다른 페이지가 보이는 동안에는 단축키를 받지 않는다. */
    active?: boolean;
    /** 「복사 페이지」로 이동 */
    onopencopy: () => void;
  } = $props();

  $effect(() => save("options", $state.snapshot(scenario.options)));
  $effect(() => save("rules", $state.snapshot(scenario.rules)));

  // ── 저장 상태: 마지막 저장과 달라졌는지만 살핀다 (저장은 직접 하거나 닫을 때 확인 창에서) ──
  $effect(() => {
    void scenario.freshLoads;
    untrack(() => sessions.forget());
  });

  $effect(() => {
    if (scenario.status === "processing") return;
    void $state.snapshot(scenario.sections);
    void $state.snapshot(scenario.rules);
    void scenario.activeIndex;
    void scenario.source;
    void scenario.sourceName;
    const handle = setTimeout(() => sessions.check(), 300);
    return () => clearTimeout(handle);
  });

  // ── 작업 제목 바꾸기: 제목을 두 번 누르거나 연필 버튼. 원본 파일 이름은 그대로고, 저장·내보내기 이름에 쓰인다. ──
  let renaming = $state(false);
  let titleDraft = $state("");
  let titleInput = $state<HTMLInputElement>();

  async function startRename() {
    titleDraft = scenario.sourceName ?? "";
    renaming = true;
    await tick();
    titleInput?.focus();
    titleInput?.select();
  }

  function commitRename() {
    if (!renaming) return;
    renaming = false;
    const name = titleDraft.trim();
    if (name) scenario.sourceName = name;
  }

  /** 「새 시나리오」: 저장 안 된 변경이 있으면 먼저 묻는다. */
  async function newScenario() {
    sessions.check();
    if (sessions.dirty) {
      const choice = await askUnsaved("새 시나리오를 열기 전에 저장할까요?", "저장하고 닫기");
      if (choice === "cancel") return;
      if (choice === "save") {
        await sessions.save();
        if (sessions.status === "error") return;
      }
    }
    scenario.reset();
    sessions.forget();
  }

  // 「방금 / n분 전」 표시를 갱신하는 시계
  let now = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(t);
  });

  // ── 세이브로 연 PDF 작업: 원본 PDF 다시 연결 ──
  let pdfInput = $state<HTMLInputElement>();
  let attachState = $state<{ file: File; mismatch: boolean } | null>(null);
  let attaching = $state(false);
  const missingImages = $derived(
    scenario.sections.reduce((n, s) => n + s.blocks.filter((b) => b.type === "image" && b.imageId).length, 0),
  );

  async function attach(file: File | undefined, force = false) {
    if (!file) return;
    attaching = true;
    try {
      const result = await scenario.attachPdf(file, force);
      attachState = result === "mismatch" ? { file, mismatch: true } : null;
    } finally {
      attaching = false;
    }
  }

  function onWindowDrop(e: DragEvent) {
    if (!active || !scenario.missingPdf) return;
    const file = [...(e.dataTransfer?.files ?? [])].find((f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf");
    if (file) {
      e.preventDefault();
      attach(file);
    }
  }

  // 현재 집합의 문장이나 치환 규칙이 바뀌면 치환 결과를 다시 계산한다 (복사 페이지도 이 결과를 쓴다).
  $effect(() => {
    void JSON.stringify(scenario.rules);
    void scenario.active?.blocks.map((b) => (b.type === "sentence" ? b.text : "")).join("\n");
    void scenario.groups.map((b) => b.text).join("\n");
    const handle = setTimeout(() => scenario.refreshSubstitutions(), 200);
    return () => clearTimeout(handle);
  });

  // ── 패널 배치: 집합 목록과 이름 치환 패널의 좌우를 바꿀 수 있다 ──
  const leftPanel = $derived(layout.editorSwap ? "rules" : "sections");
  const rightPanel = $derived(layout.editorSwap ? "sections" : "rules");
  const isOpen = (panel: "sections" | "rules") => (panel === "sections" ? layout.sectionsOpen : layout.rulesOpen);
  const widthOf = (panel: "sections" | "rules") => (panel === "sections" ? "210px" : "320px");
  const panelName = (panel: "sections" | "rules") => (panel === "sections" ? "집합 목록" : "이름 치환 패널");

  function toggle(panel: "sections" | "rules") {
    if (panel === "sections") layout.sectionsOpen = !layout.sectionsOpen;
    else layout.rulesOpen = !layout.rulesOpen;
  }

  const viewer = $derived(layout.viewerOpen && !!scenario.source);

  // 열 순서: [왼쪽 패널] [원본(왼쪽)] [문장 목록] [원본(오른쪽)] [오른쪽 패널]
  const columns = $derived(
    [
      isOpen(leftPanel) ? widthOf(leftPanel) : "",
      viewer && layout.viewerSide === "left" ? `${layout.viewerWidth}px 1px` : "",
      "minmax(360px, 1fr)",
      viewer && layout.viewerSide === "right" ? `1px ${layout.viewerWidth}px` : "",
      isOpen(rightPanel) ? widthOf(rightPanel) : "",
    ]
      .filter(Boolean)
      .join(" "),
  );

  // ── 줄 찾기: 칩을 누르면 커서 다음의 해당 줄로 간다 (편집기에서는 줄을 숨기지 않는다) ──
  const filters: { id: Exclude<Filter, "all">; label: string }[] = [
    { id: "dialogue", label: "대사" },
    { id: "gm", label: "GM 정보" },
    { id: "warning", label: "경고" },
    { id: "image", label: "그림" },
    { id: "group", label: "그룹" },
    { id: "note", label: "메모" },
  ];

  const counts = $derived.by(() => {
    const blocks = scenario.active?.blocks ?? [];
    return Object.fromEntries(filters.map((f) => [f.id, blocks.filter((b) => matchesFilter(b, f.id)).length])) as Record<Filter, number>;
  });

  function jumpTo(filter: Filter) {
    const byId = new Map((scenario.active?.blocks ?? []).map((b) => [b.id, b]));
    editor.handle?.jumpNext((id) => {
      const b = byId.get(id);
      return !!b && matchesFilter(b, filter);
    });
  }

  function undo() {
    scenario.undo();
  }
</script>

<svelte:window ondrop={onWindowDrop} />

{#snippet sidePanel(panel: "sections" | "rules", side: "left" | "right")}
  {#if isOpen(panel)}
    <div class="side {side}" style:order={side === "left" ? 1 : 7}>
      {#if panel === "sections"}<SectionList />{:else}<RulesPanel />{/if}
    </div>
  {/if}
{/snippet}

{#if !scenario.sourceName}
  <ImportPanel {active} />
{:else}
  <div class="workspace">
    <header class="topbar">
      <button class="icon-btn" onclick={() => toggle(leftPanel)} title="{panelName(leftPanel)} {isOpen(leftPanel) ? '닫기' : '열기'}">
        {#if isOpen(leftPanel)}<PanelLeftClose size={18} />{:else}<PanelLeftOpen size={18} />{/if}
      </button>
      <div class="source">
        <FileText size={18} />
        <div class="source-text">
          {#if renaming}
            <input
              class="input title-input"
              bind:this={titleInput}
              bind:value={titleDraft}
              aria-label="작업 제목"
              onkeydown={(e) => {
                if (e.isComposing || e.keyCode === 229) return;
                if (e.key === "Enter") commitRename();
                else if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  renaming = false;
                }
              }}
              onblur={commitRename}
            />
          {:else}
            <span class="title">
              <strong title="{scenario.sourceName} — 두 번 누르면 제목 바꾸기" ondblclick={startRename}>{scenario.sourceName}</strong>
              <button class="icon-btn rename" onclick={startRename} title="제목 바꾸기 (저장·내보내기 이름에 쓰임)" aria-label="제목 바꾸기">
                <Pencil size={13} />
              </button>
            </span>
          {/if}
          <span class="muted status">
            {#if scenario.status === "processing"}
              <LoaderCircle size={12} class="spin" />
              {scenario.progress.done}/{scenario.progress.total}{scenario.progress.unit} 처리 중
            {:else if scenario.status === "error"}
              <span class="error"><TriangleAlert size={12} /> {scenario.error}</span>
            {:else}
              {scenario.status === "cancelled" ? "중간에 멈춤 · " : ""}
              쪽수 {scenario.stats.removedPageNumbers}개 · 머리글/바닥글 {scenario.stats.removedHeaders}개 제거
              {#if scenario.stats.pagesWithoutText.length}
                · <span class="warn-text" title="스캔본이면 글자를 읽을 수 없어 쪽 전체를 그림으로 넣었습니다">
                  글자 없는 쪽 {scenario.stats.pagesWithoutText.length}개
                </span>
              {/if}
              <span class="save-state" class:error={sessions.status === "error"} class:dirty={sessions.dirty} title={sessions.error ?? "⌘/Ctrl+S 또는 「저장」으로 저장합니다"}>
                ·
                {#if sessions.status === "saving"}
                  <LoaderCircle size={11} class="spin" /> 저장 중
                {:else if sessions.status === "error"}
                  <TriangleAlert size={11} /> 저장 실패
                {:else if sessions.dirty}
                  저장 안 된 변경 있음
                {:else if sessions.savedAt}
                  <Save size={11} /> 저장됨 {timeAgo(sessions.savedAt, now)}
                {/if}
              </span>
            {/if}
          </span>
        </div>
        {#if scenario.status === "processing"}
          <button class="btn sm" onclick={() => scenario.cancel()}><X size={14} /> 멈추기</button>
        {/if}
      </div>

      <button class="btn primary" onclick={onopencopy} title="복사 페이지로 이동 (돌아올 때는 Esc)">
        <Play size={15} /> 복사 페이지
      </button>

      <button
        class="btn sm save"
        class:dirty={sessions.dirty}
        onclick={() => sessions.save()}
        disabled={sessions.status === "saving" || scenario.status === "processing"}
        title="앱 안에 저장 (⌘/Ctrl+S)"
      >
        {#if sessions.status === "saving"}<LoaderCircle size={14} class="spin" />{:else}<Save size={14} />{/if}
        {sessions.dirty ? "저장" : "저장됨"}
      </button>
      <ExportMenu />
      <button class="btn sm ghost" onclick={newScenario} title="이 시나리오를 닫고 새로 불러오기 (저장 안 된 변경이 있으면 먼저 물어봅니다)">
        <RotateCcw size={14} /> 새 시나리오
      </button>
      <button
        class="btn sm"
        class:on={viewer}
        onclick={() => (layout.viewerOpen = !layout.viewerOpen)}
        disabled={!scenario.source}
        title="원본 {scenario.source?.kind === 'pdf' ? 'PDF' : '텍스트'}를 옆에 띄워 비교하며 고치기"
        aria-pressed={viewer}
      >
        <BookOpenText size={15} /> 원본
      </button>
      <button class="icon-btn" onclick={() => (layout.editorSwap = !layout.editorSwap)} title="집합 목록과 이름 치환 패널의 좌우 바꾸기">
        <ArrowLeftRight size={17} />
      </button>
      <button class="icon-btn" onclick={() => toggle(rightPanel)} title="{panelName(rightPanel)} {isOpen(rightPanel) ? '닫기' : '열기'}">
        {#if isOpen(rightPanel)}<PanelRightClose size={18} />{:else}<PanelRightOpen size={18} />{/if}
      </button>
    </header>

    {#if scenario.missingPdf}
      <div class="attach">
        <Link size={16} />
        <span>
          {#if attachState?.mismatch}
            <strong>고른 「{attachState.file.name}」은 처음 정리한 PDF와 다른 파일 같아요.</strong> 그래도 연결하면 그림 위치가 어긋날 수 있습니다.
          {:else}
            <strong>원본 PDF가 연결되지 않았습니다.</strong> 같은 PDF를 고르거나 창에 끌어다 놓으면
            {missingImages ? `그림 ${missingImages}개와 ` : ""}원본 보기가 돌아옵니다. (세이브에는 가볍게 하려고 PDF를 넣지 않아요)
          {/if}
        </span>
        {#if attachState?.mismatch}
          <button class="btn sm" onclick={() => (attachState = null)}>취소</button>
          <button class="btn sm primary" onclick={() => attach(attachState?.file, true)} disabled={attaching}>그래도 연결</button>
        {:else}
          <button class="btn sm primary" onclick={() => pdfInput?.click()} disabled={attaching}>
            {#if attaching}<LoaderCircle size={14} class="spin" /> 연결 중{:else}<FolderOpen size={14} /> PDF 고르기{/if}
          </button>
        {/if}
        <input bind:this={pdfInput} type="file" accept=".pdf,application/pdf" hidden onchange={(e) => attach(e.currentTarget.files?.[0])} />
      </div>
    {/if}

    {#if scenario.status === "processing"}
      <div class="load-bar"><div class="fill" style:width="{(scenario.progress.done / Math.max(1, scenario.progress.total)) * 100}%"></div></div>
    {/if}

    <div class="columns" style:grid-template-columns={columns}>
      {@render sidePanel(leftPanel, "left")}

      {#if viewer}
        {@const left = layout.viewerSide === "left"}
        <div class="viewer-slot" style:order={left ? 2 : 6}><SourceViewer /></div>
        <div class="split" style:order={left ? 3 : 5}>
          <Splitter bind:size={layout.viewerWidth} invert={left} min={300} max={1400} label="원본 보기 너비 조절" />
        </div>
      {/if}

      <section class="content" style:order="4">
        <div class="toolbar">
          <div class="filters" aria-label="줄 찾기">
            {#each filters as f (f.id)}
              <button class="filter" onclick={() => jumpTo(f.id)} disabled={!counts[f.id]} title="다음 「{f.label}」 줄로 이동">
                {f.label} <span class="count">{counts[f.id]}</span>
              </button>
            {/each}
          </div>
          <div class="tools">
            <span class="toggle" title="이름 치환 결과를 문장 아래에 보여줍니다">
              <Switch size="sm" bind:checked={scenario.showPreview}><Eye size={14} /> 치환 미리보기</Switch>
            </span>
            <button class="btn sm" onclick={() => editor.handle?.selectAll()} title="집합 전체 선택 (⌘/Ctrl+A)"><ListChecks size={14} /> 전체 선택</button>
            <button class="btn sm" onclick={undo} disabled={!scenario.canUndo} title="집합 나누기·합치기·삭제·이름 바꾸기 되돌리기 (글자 수정은 ⌘Z)">
              <Undo2 size={14} /> 집합 되돌리기
            </button>
          </div>
        </div>
        <LineBar />
        <p class="keys muted">
          한 줄이 복사 카드 하나 · Enter로 줄 나누기 · ⌘/Ctrl+Enter 다음 줄 · ⌘⇧G 그룹으로 묶기 · ⌘⇧M 메모 · ⌘Z 되돌리기
        </p>
        {#if scenario.active}
          {#key scenario.active.id}
            <SectionEditor sectionId={scenario.active.id} />
          {/key}
        {:else}
          <p class="empty muted">{scenario.status === "processing" ? "첫 집합을 정리하고 있습니다…" : "정리된 문장이 없습니다."}</p>
        {/if}
      </section>

      {@render sidePanel(rightPanel, "right")}
    </div>
  </div>
{/if}

<style>
  .workspace {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }

  .topbar {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto auto auto auto auto auto auto;
    gap: 14px;
    align-items: center;
    padding: 10px 16px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }

  .source {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .source-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .title {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
  }

  .source-text strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rename {
    flex: none;
    width: 22px;
    height: 22px;
    opacity: 0;
    transition: opacity 0.1s;
  }

  .title:hover .rename,
  .rename:focus-visible {
    opacity: 1;
  }

  .title-input {
    width: 320px;
    max-width: 100%;
    height: 26px;
    font-size: 14px;
    font-weight: 600;
  }

  .status {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .error {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--danger);
  }

  .warn-text {
    color: var(--warn);
  }

  .fill {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--accent);
    transition: width 0.2s;
  }

  .save-state {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }

  .save-state.error {
    color: var(--danger);
  }

  .save-state.dirty {
    color: var(--warn);
  }

  .btn.save {
    color: var(--text-muted);
  }

  .btn.save.dirty {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--accent-contrast);
  }

  .attach {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 16px;
    border-bottom: 1px solid var(--border);
    background: var(--warn-soft);
    color: var(--text);
    font-size: 13px;
  }

  .attach > :global(svg) {
    flex: none;
    color: var(--warn);
  }

  .attach span {
    flex: 1;
  }

  .load-bar {
    height: 2px;
    background: var(--surface-3);
  }

  .load-bar .fill {
    border-radius: 0;
  }

  .columns {
    display: grid;
    flex: 1;
    min-height: 0;
  }

  .side {
    min-height: 0;
    overflow: hidden;
  }

  .side.left {
    border-right: 1px solid var(--border);
  }

  .side.right {
    border-left: 1px solid var(--border);
  }

  .viewer-slot {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .split {
    display: flex;
    min-height: 0;
  }

  .btn.on {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
  }

  .content {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  .toolbar {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--border);
  }

  .filters,
  .tools,

  .filter:disabled {
    opacity: 0.45;
  }

  .filter:not(:disabled):hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .filter {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface);
    font-size: 12px;
  }


  .count {
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }



  .btn.danger {
    color: var(--danger);
  }

  .btn.danger:hover:not(:disabled) {
    border-color: var(--danger);
    background: var(--danger-soft);
  }

  .toggle {
    margin-right: 6px;
  }

  .keys {
    margin: 0;
    padding: 6px 16px 0;
    font-size: 11px;
  }


  .empty {
    padding: 40px;
    text-align: center;
  }

  :global(.spin) {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
