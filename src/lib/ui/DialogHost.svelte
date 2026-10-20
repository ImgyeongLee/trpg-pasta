<script lang="ts">
  import { TriangleAlert } from "$lib/icons";
  import { dialog } from "./dialog.svelte";

  let box = $state<HTMLDivElement>();

  // 열리면 첫 번째(기본) 버튼에 포커스, Esc는 취소
  $effect(() => {
    if (!dialog.current) return;
    box?.querySelector<HTMLButtonElement>("button[data-primary]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        dialog.answer("cancel");
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });
</script>

{#if dialog.current}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="backdrop" onclick={(e) => e.target === e.currentTarget && dialog.answer("cancel")}>
    <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dialog-title" bind:this={box}>
      <h2 id="dialog-title"><TriangleAlert size={18} /> {dialog.current.title}</h2>
      <p>{dialog.current.message}</p>
      <div class="actions">
        {#each dialog.current.actions as action (action.id)}
          <button
            class="btn"
            class:primary={action.variant === "primary"}
            class:danger={action.variant === "danger"}
            data-primary={action.variant === "primary" ? "" : undefined}
            onclick={() => dialog.answer(action.id)}
          >
            {action.label}
          </button>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 200;
    display: grid;
    place-items: center;
    padding: 24px;
    background: rgb(0 0 0 / 40%);
    animation: fade 0.12s ease-out;
  }

  .dialog {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: min(440px, 100%);
    padding: 20px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface);
    box-shadow: 0 20px 60px rgb(0 0 0 / 30%);
  }

  h2 {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    font-size: 16px;
  }

  h2 :global(svg) {
    color: var(--warn);
  }

  p {
    margin: 0;
    color: var(--text-muted);
    line-height: 1.6;
    white-space: pre-line;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
  }

  .btn.danger {
    color: var(--danger);
  }

  .btn.danger:hover {
    border-color: var(--danger);
    background: var(--danger-soft);
  }

  @keyframes fade {
    from {
      opacity: 0;
    }
  }
</style>
