<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    checked = $bindable(false),
    label,
    hint,
    size = "md",
    children,
  }: {
    checked: boolean;
    label?: string;
    hint?: string;
    size?: "sm" | "md";
    /** 라벨 대신 직접 그릴 내용 (아이콘 포함 등) */
    children?: Snippet;
  } = $props();
</script>

<button type="button" class="switch {size}" role="switch" aria-checked={checked} onclick={() => (checked = !checked)}>
  <span class="track" class:on={checked}><span class="thumb"></span></span>
  {#if children || label || hint}
    <span class="text">
      {#if children}{@render children()}{:else if label}<span class="label">{label}</span>{/if}
      {#if hint}<span class="hint">{hint}</span>{/if}
    </span>
  {/if}
</button>

<style>
  .switch {
    display: inline-flex;
    align-items: flex-start;
    gap: 10px;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    text-align: left;
  }

  .switch:focus-visible {
    outline: none;
  }

  .switch:focus-visible .track {
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .track {
    position: relative;
    flex: none;
    width: 34px;
    height: 20px;
    margin-top: 1px;
    border-radius: 999px;
    background: var(--border-strong);
    transition: background 0.15s;
  }

  .sm .track {
    width: 28px;
    height: 16px;
    margin-top: 0;
  }

  .track.on {
    background: var(--accent);
  }

  .thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 2px rgb(0 0 0 / 25%);
    transition: transform 0.15s;
  }

  .sm .thumb {
    width: 12px;
    height: 12px;
  }

  .on .thumb {
    transform: translateX(14px);
  }

  .sm .on .thumb {
    transform: translateX(12px);
  }

  .text {
    display: flex;
    flex-direction: column;
  }

  .sm .text {
    flex-direction: row;
    align-items: center;
    gap: 4px;
    font-size: 12px;
  }

  .label {
    font-weight: 500;
  }

  .hint {
    color: var(--text-muted);
    font-size: 12px;
  }
</style>
