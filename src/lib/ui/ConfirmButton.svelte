<script lang="ts">
  // 두 번 눌러야 실행되는 버튼 (실수로 지우지 않게).
  // 첫 번째 클릭 → 빨간 「한 번 더 눌러 삭제」로 바뀌고 아래 막대가 줄어든다. 막대가 다 줄기 전에 한 번 더 누르면 실행.
  // 시간이 지나거나, Esc를 누르거나, 다른 곳을 누르면 원래대로 돌아간다.
  import type { Component } from "svelte";
  import { Trash } from "$lib/icons";

  let {
    onconfirm,
    label,
    confirmLabel = "한 번 더 눌러 삭제",
    title = "삭제 (두 번 눌러야 지워집니다)",
    icon: Icon = Trash,
    variant = "icon",
    timeout = 3000,
    onarmchange,
  }: {
    onconfirm: () => void;
    /** 평소에 아이콘 옆에 보일 글자 (없으면 아이콘만) */
    label?: string;
    confirmLabel?: string;
    title?: string;
    icon?: Component<{ size?: number }>;
    /** icon: 작은 아이콘 버튼 / button: 글자 있는 버튼 */
    variant?: "icon" | "button";
    timeout?: number;
    /** 확인 대기 상태가 바뀔 때 (부모가 지워질 항목 전체를 강조할 때 쓴다) */
    onarmchange?: (armed: boolean) => void;
  } = $props();

  let armed = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  function setArmed(value: boolean) {
    if (armed === value) return;
    armed = value;
    onarmchange?.(value);
  }

  function disarm() {
    clearTimeout(timer);
    setArmed(false);
  }

  function onclick(e: MouseEvent) {
    e.stopPropagation();
    if (!armed) {
      setArmed(true);
      clearTimeout(timer);
      timer = setTimeout(disarm, timeout);
      return;
    }
    disarm();
    onconfirm();
  }

  function onkeydown(e: KeyboardEvent) {
    if (armed && e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      disarm();
    }
  }
</script>

<button
  type="button"
  class="confirm {variant}"
  class:armed
  title={armed ? `${confirmLabel} — Esc로 취소` : title}
  aria-label={armed ? confirmLabel : (label ?? "삭제")}
  {onclick}
  {onkeydown}
  onblur={disarm}
>
  <Icon size={variant === "icon" && !armed ? 15 : 14} />
  {#if armed}
    <span class="text" aria-live="assertive">{confirmLabel}</span>
    <span class="timer" style:animation-duration="{timeout}ms"></span>
  {:else if label}
    <span class="text">{label}</span>
  {/if}
</button>

<style>
  .confirm {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    transition: background 0.12s, color 0.12s, border-color 0.12s;
  }

  .confirm.icon {
    height: 26px;
    min-width: 26px;
    justify-content: center;
    padding: 0 5px;
  }

  .confirm.button {
    height: 26px;
    padding: 0 8px;
    border-color: var(--border);
    background: var(--surface);
    font-size: 12px;
  }

  .confirm:hover {
    color: var(--danger);
    background: var(--danger-soft);
    border-color: transparent;
  }

  .confirm.armed {
    padding: 0 9px;
    border-color: var(--danger);
    background: var(--danger);
    color: var(--danger-contrast);
    font-size: 12px;
    font-weight: 600;
    animation: nudge 0.25s ease-out;
  }

  .confirm.armed:hover {
    background: var(--danger);
    color: var(--danger-contrast);
  }

  /* 남은 시간: 버튼 아래쪽 막대가 오른쪽에서부터 줄어든다 */
  .timer {
    position: absolute;
    left: 0;
    bottom: 0;
    height: 3px;
    width: 100%;
    background: currentColor;
    opacity: 0.7;
    transform-origin: left;
    animation-name: drain;
    animation-timing-function: linear;
    animation-fill-mode: forwards;
  }

  @keyframes drain {
    to {
      transform: scaleX(0);
    }
  }

  @keyframes nudge {
    0% {
      transform: scale(0.94);
    }
    60% {
      transform: scale(1.04);
    }
    100% {
      transform: scale(1);
    }
  }
</style>
