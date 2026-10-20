<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { ArrowRight, Plus, Replace, Trash, WandSparkles } from "$lib/icons";
  import Select from "$lib/ui/Select.svelte";
  import type { SelectOption } from "$lib/ui/select";
  import { scenario } from "./state.svelte";
  import type { BatchimMode } from "./types";

  const batchimOptions: SelectOption<BatchimMode>[] = [
    { value: "auto", label: "받침 자동", hint: "이름 끝 글자로 판단", icon: WandSparkles },
    { value: "yes", label: "받침 있음", hint: "은 · 이 · 을 · 으로" },
    { value: "no", label: "받침 없음", hint: "는 · 가 · 를 · 로" },
    { value: "rieul", label: "ㄹ 받침", hint: "은 · 이 · 을 · 로" },
  ];

  let examples = $state<Record<number, string>>({});

  // 규칙마다 '라벨은/가/를/로' 예시를 Rust로 치환해 보여준다.
  $effect(() => {
    const rules = $state.snapshot(scenario.rules);
    const handle = setTimeout(async () => {
      const active = rules.filter((r) => r.label.trim() && r.name.trim());
      if (!active.length) {
        examples = {};
        return;
      }
      const samples = active.map((r) => `${r.label.trim()}은 · ${r.label.trim()}가 · ${r.label.trim()}를 · ${r.label.trim()}로`);
      const out = await invoke<string[]>("apply_substitutions", { texts: samples, rules });
      examples = Object.fromEntries(active.map((r, i) => [r.id, out[i]]));
    }, 150);
    return () => clearTimeout(handle);
  });

  const known = $derived(new Set(scenario.rules.map((r) => r.label.trim())));
</script>

<aside class="panel">
  <header>
    <Replace size={16} />
    <h2>이름 치환</h2>
  </header>
  <p class="hint muted">
    라벨을 캐릭터 이름으로 바꾸고, 이름의 받침에 맞게 조사(은/는, 이/가, 을/를, (으)로, 였다/이었다 등)를 고칩니다.
    원문은 그대로 두고 복사할 때 적용됩니다.
  </p>

  <div class="rules">
    {#each scenario.rules as rule (rule.id)}
      <div class="rule">
        <div class="fields">
          <input class="input label" bind:value={rule.label} placeholder="라벨" aria-label="바꿀 라벨" />
          <ArrowRight size={14} class="arrow" />
          <input class="input name" bind:value={rule.name} placeholder="캐릭터 이름" aria-label="바꿀 이름" />
          <button class="icon-btn" onclick={() => scenario.removeRule(rule.id)} title="규칙 삭제"><Trash size={14} /></button>
        </div>
        <div class="sub">
          <Select label="이름 끝소리 (조사 선택 기준)" size="sm" options={batchimOptions} bind:value={rule.batchim} />
          {#if examples[rule.id]}
            <span class="example">{examples[rule.id]}</span>
          {/if}
        </div>
      </div>
    {/each}
    <button class="btn sm add" onclick={() => scenario.addRule()}><Plus size={14} /> 규칙 추가</button>
  </div>

  {#if scenario.detected.length}
    <div class="detected">
      <h3>시나리오에서 찾은 라벨</h3>
      <div class="chips">
        {#each scenario.detected as item (item.label)}
          <button class="chip" disabled={known.has(item.label)} onclick={() => scenario.addRule(item.label)} title={known.has(item.label) ? "이미 규칙이 있습니다" : "규칙으로 추가"}>
            {item.label} <span class="count">{item.count}</span>
          </button>
        {/each}
      </div>
    </div>
  {/if}
</aside>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
    height: 100%;
    padding: 16px;
    background: var(--surface);
    overflow-y: auto;
  }

  header {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  h2 {
    margin: 0;
    font-size: 15px;
  }

  h3 {
    margin: 0 0 8px;
    font-size: 12px;
    color: var(--text-muted);
  }

  .hint {
    margin: 0;
    font-size: 12px;
  }

  .rules {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .rule {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface-2);
  }

  .fields {
    display: grid;
    grid-template-columns: 80px auto 1fr auto;
    gap: 6px;
    align-items: center;
  }

  .fields :global(.arrow) {
    color: var(--text-faint);
  }

  .sub {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .example {
    color: var(--accent);
    font-size: 12px;
  }

  .add {
    align-self: flex-start;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface);
    font-size: 12px;
  }

  .chip:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }

  .chip:disabled {
    opacity: 0.5;
  }

  .count {
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }
</style>
