<script lang="ts">
  import { Plus } from "$lib/icons";
  import ConfirmButton from "$lib/ui/ConfirmButton.svelte";
  import MacroCard from "./MacroCard.svelte";
  import { macros } from "./state.svelte";

  let { editing = false, compact = false }: { editing?: boolean; compact?: boolean } = $props();

  function renameGroup(from: string, input: HTMLInputElement) {
    if (!macros.renameGroup(from, input.value)) input.value = from;
  }

</script>

<div class="groups" class:compact>
  {#each macros.groups as group (group)}
    {@const items = macros.inGroup(group)}
    {#if editing || items.length}
      <section class="group">
        <header>
          {#if editing}
            <input
              class="input group-name"
              value={group}
              aria-label="그룹 이름"
              onchange={(e) => renameGroup(group, e.currentTarget)}
              onkeydown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            />
            <button class="btn sm" onclick={() => macros.add(group)}><Plus size={14} /> 매크로 추가</button>
            <ConfirmButton
              variant="button"
              label="그룹 삭제"
              title="그룹과 그 안의 매크로 삭제 (두 번 눌러야 지워집니다)"
              confirmLabel={items.length ? `한 번 더 눌러 매크로 ${items.length}개와 함께 삭제` : "한 번 더 눌러 삭제"}
              onconfirm={() => macros.removeGroup(group)}
            />
          {:else}
            <h3>{group}</h3>
            <span class="count">{items.length}</span>
          {/if}
        </header>
        <div class="cards">
          {#each items as macro (macro.id)}
            <MacroCard {macro} {editing} {compact} />
          {:else}
            <p class="empty muted">이 그룹에 매크로가 없습니다.</p>
          {/each}
        </div>
      </section>
    {/if}
  {/each}
</div>

<style>
  .groups {
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .groups.compact {
    gap: 16px;
  }

  header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }

  h3 {
    margin: 0;
    font-size: 13px;
    color: var(--text-muted);
  }

  .count {
    color: var(--text-faint);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  .group-name {
    width: 200px;
    font-weight: 600;
  }

  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 12px;
    align-items: start;
  }

  .compact .cards {
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 8px;
  }

  .empty {
    margin: 0;
    font-size: 13px;
  }

</style>
