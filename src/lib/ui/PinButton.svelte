<script lang="ts">
  // 「항상 위에 고정」 토글. 켜면 CCFOLIA 등 다른 창을 눌러도 이 창이 뒤로 가려지지 않는다.
  import { Pin, PinOff } from "$lib/icons";
  import { layout } from "$lib/layout.svelte";

  let { variant = "icon" }: { variant?: "icon" | "rail" } = $props();

  const title = $derived(layout.alwaysOnTop ? "항상 위에 고정 해제" : "항상 위에 고정 (다른 창을 눌러도 가려지지 않음)");
</script>

<button
  class={variant === "rail" ? "rail-pin" : "icon-btn pin"}
  class:on={layout.alwaysOnTop}
  onclick={() => (layout.alwaysOnTop = !layout.alwaysOnTop)}
  {title}
  aria-pressed={layout.alwaysOnTop}
>
  {#if layout.alwaysOnTop}<Pin size={variant === "rail" ? 20 : 17} />{:else}<PinOff size={variant === "rail" ? 20 : 17} />{/if}
  {#if variant === "rail"}<span>{layout.alwaysOnTop ? "고정됨" : "위에 고정"}</span>{/if}
</button>

<style>
  .rail-pin {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    width: 100%;
    padding: 10px 4px;
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    color: var(--text-muted);
    font-size: 11px;
    line-height: 1.2;
    word-break: keep-all;
  }

  .rail-pin:hover {
    background: var(--surface-3);
    color: var(--text);
  }

  .on {
    background: var(--accent-soft);
    color: var(--accent);
  }

  .rail-pin.on {
    font-weight: 600;
  }
</style>
