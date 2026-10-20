<script lang="ts">
  import { FolderPlus, Pencil, SquareTerminal, TriangleAlert } from "$lib/icons";
  import GroupList from "$lib/play/GroupList.svelte";
  import Switch from "$lib/ui/Switch.svelte";
  import MacroList from "./MacroList.svelte";
  import { macros } from "./state.svelte";

  let editing = $state(false);

  $effect(() => {
    macros.load();
  });
</script>

<div class="board">
  <header>
    <div class="title">
      <SquareTerminal size={22} />
      <div>
        <h1>채팅 매크로</h1>
        <p class="muted">
          판정 명령어나 꾸민 문구를 저장해 두고 버튼 한 번으로 복사합니다.
          <code>{"{관련}"}</code> 은 입력칸, <code>{"{기능:관찰력/듣기}"}</code> 는 선택 버튼이 됩니다.
        </p>
      </div>
    </div>
    <div class="tools">
      {#if editing}
        <button class="btn sm" onclick={() => macros.addGroup()}><FolderPlus size={14} /> 그룹 추가</button>
      {/if}
      <Switch bind:checked={editing}><span class="edit-label"><Pencil size={14} /> 편집</span></Switch>
    </div>
  </header>

  {#if macros.error}
    <p class="error"><TriangleAlert size={14} /> {macros.error}</p>
  {/if}

  {#if macros.loaded}
    <MacroList {editing} />
    {#if !editing && macros.macros.length === 0}
      <p class="empty muted">저장된 매크로가 없습니다. 오른쪽 위 「편집」을 켜고 추가하세요.</p>
    {/if}
  {/if}

  <GroupList />
</div>

<style>
  .board {
    height: 100vh;
    padding: 28px 32px 64px;
    overflow-y: auto;
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    margin-bottom: 24px;
  }

  .title {
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }

  .title :global(svg) {
    margin-top: 2px;
    color: var(--accent);
  }

  h1 {
    margin: 0 0 4px;
    font-size: 20px;
  }

  p {
    margin: 0;
  }

  code {
    padding: 1px 5px;
    border-radius: 4px;
    background: var(--surface-3);
    color: var(--text);
    font-size: 12px;
  }

  .tools {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: none;
  }

  .edit-label {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-weight: 500;
  }

  .error {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 16px;
    color: var(--danger);
  }

  .empty {
    padding: 40px;
    text-align: center;
  }
</style>
