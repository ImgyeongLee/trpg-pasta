<script lang="ts">
  import { BookOpen, Play, SquareTerminal } from "$lib/icons";
  import MacroBoard from "$lib/macros/MacroBoard.svelte";
  import { macros } from "$lib/macros/state.svelte";
  import CopyPage from "$lib/play/CopyPage.svelte";
  import ScenarioPrep from "$lib/scenario/ScenarioPrep.svelte";
  import { layout } from "$lib/layout.svelte";
  import PinButton from "$lib/ui/PinButton.svelte";
  import { setAlwaysOnTop } from "$lib/window";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import DialogHost from "$lib/ui/DialogHost.svelte";
  import { askUnsaved, sessions } from "$lib/scenario/session.svelte";
  import { scenario } from "$lib/scenario/state.svelte";

  // 편집 페이지들. GM 도구가 늘어나면 여기에 추가한다.
  const editors = [
    { id: "scenario", label: "시나리오 준비", icon: BookOpen },
    { id: "macros", label: "채팅 매크로", icon: SquareTerminal },
  ] as const;
  type Editor = (typeof editors)[number]["id"];

  /** 지금 보고 있는 편집 페이지 (복사 페이지에서 Esc로 돌아올 곳) */
  let editor = $state<Editor>("scenario");
  let copying = $state(false);

  const backLabel = $derived(editors.find((e) => e.id === editor)?.label ?? "편집");

  // 「항상 위에 고정」 설정을 창에 반영한다 (시작할 때도 저장된 값으로).
  $effect(() => {
    setAlwaysOnTop(layout.alwaysOnTop);
  });

  // 창을 닫을 때 저장 안 된 변경이 있으면 먼저 묻는다 (자동 저장은 하지 않는다).
  $effect(() => {
    let unlisten: (() => void) | undefined;
    const win = getCurrentWindow();
    win
      .onCloseRequested(async (event) => {
        sessions.check();
        if (!sessions.dirty) return;
        event.preventDefault();
        const choice = await askUnsaved("닫기 전에 저장할까요?", "저장하고 닫기");
        if (choice === "cancel") return;
        if (choice === "save") {
          await sessions.save();
          if (sessions.status === "error") return; // 저장에 실패하면 닫지 않는다
        }
        await win.destroy();
      })
      .then((u) => (unlisten = u))
      .catch(() => {}); // 데스크탑 앱이 아닐 때(브라우저)는 무시
    return () => unlisten?.();
  });

  /** ⌘/Ctrl+S: 저장 */
  function onKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && scenario.sessionId && scenario.status !== "processing") {
      e.preventDefault();
      sessions.save();
    }
  }

  // 복사 페이지에서도 바로 쓸 수 있게 시작할 때 불러온다.
  $effect(() => {
    macros.load();
  });
</script>

<!--
  창에 파일을 끌어다 놓았을 때 웹뷰가 그 파일을 열어 앱 화면을 덮어 버리지 않게 막는다.
  (실제로 파일을 받는 곳은 시나리오 불러오기 화면뿐이다.)
-->
<svelte:window ondragover={(e) => e.preventDefault()} ondrop={(e) => e.preventDefault()} onkeydown={onKeydown} />

<DialogHost />

{#if copying}
  <CopyPage {backLabel} onclose={() => (copying = false)} />
{/if}

<!-- 복사 페이지에 다녀와도 작업 중인 내용이 그대로 남도록 편집 페이지는 숨기기만 한다. -->
<div class="shell" hidden={copying}>
  <nav class="rail" aria-label="페이지">
    {#each editors as item (item.id)}
      <button class="rail-item" class:active={editor === item.id} onclick={() => (editor = item.id)} title={item.label}>
        <item.icon size={20} />
        <span>{item.label}</span>
      </button>
    {/each}
    <div class="spacer"></div>
    <PinButton variant="rail" />
    <button class="rail-item play" onclick={() => (copying = true)} title="복사 페이지 (돌아올 때는 Esc)">
      <Play size={20} />
      <span>복사</span>
    </button>
  </nav>
  <main class="main">
    <div class="page" hidden={editor !== "scenario"}>
      <ScenarioPrep active={!copying && editor === "scenario"} onopencopy={() => (copying = true)} />
    </div>
    {#if editor === "macros"}
      <MacroBoard />
    {/if}
  </main>
</div>

<style>
  .shell {
    display: grid;
    grid-template-columns: 76px 1fr;
    height: 100vh;
  }

  .shell[hidden],
  .page[hidden] {
    display: none;
  }

  .rail {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px 8px;
    border-right: 1px solid var(--border);
    background: var(--surface);
  }

  .spacer {
    flex: 1;
  }

  .rail-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 10px 4px;
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    color: var(--text-muted);
    font-size: 11px;
    line-height: 1.2;
    text-align: center;
    word-break: keep-all;
  }

  .rail-item:hover {
    background: var(--surface-3);
    color: var(--text);
  }

  .rail-item.active {
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: 600;
  }

  .rail-item.play {
    color: var(--accent);
  }

  /* 내용이 창보다 길면(시작 화면 등) 페이지 전체가 아니라 여기만 스크롤한다 — 왼쪽 레일이 끊기지 않게. */
  .main {
    min-width: 0;
    min-height: 0;
    overflow: auto;
  }
</style>
