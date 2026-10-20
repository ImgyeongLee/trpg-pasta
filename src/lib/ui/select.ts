import type { Component } from "svelte";

export interface SelectOption<V extends string> {
  value: V;
  label: string;
  /** 목록에서 라벨 아래에 보이는 설명 */
  hint?: string;
  icon?: Component<{ size?: number }>;
}
