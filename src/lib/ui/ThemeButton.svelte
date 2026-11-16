<script lang="ts">
  // 색 테마 버튼: 누를 때마다 시스템 → 라이트 → 다크. 설정은 layout에 저장된다.
  import { Monitor, Moon, Sun } from "$lib/icons";
  import { layout, type Theme } from "$lib/layout.svelte";

  const NEXT: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
  const LABEL: Record<Theme, string> = { system: "시스템", light: "라이트", dark: "다크" };
</script>

<button
  class="rail-theme"
  onclick={() => (layout.theme = NEXT[layout.theme])}
  title="테마: {LABEL[layout.theme]} (누르면 {LABEL[NEXT[layout.theme]]})"
  aria-label="테마 바꾸기, 지금 {LABEL[layout.theme]}"
>
  {#if layout.theme === "light"}<Sun size={20} />{:else if layout.theme === "dark"}<Moon size={20} />{:else}<Monitor size={20} />{/if}
  <span>{LABEL[layout.theme]}</span>
</button>

<style>
  .rail-theme {
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

  .rail-theme:hover {
    background: var(--surface-3);
    color: var(--text);
  }
</style>
