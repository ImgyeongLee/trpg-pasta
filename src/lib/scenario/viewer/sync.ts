// 원본 뷰어 → 문장 목록 방향 연동: 원본에서 누른 글자가 들어 있는 줄로 목록을 옮긴다.

import { focusBlock } from "../focus";
import { scenario } from "../state.svelte";
import type { Block, Section } from "../types";
import { squash } from "./match";

/** PDF에서 누른 자리 앞뒤 글자(가운데가 누른 자리)로 만든 후보: 전체 → 가운데 → 뒤 → 앞 */
export function aroundClick(snippet: string): string[] {
  const s = squash(snippet);
  const mid = Math.floor(s.length / 2);
  return [s, s.slice(Math.max(0, mid - 3), mid + 3), s.slice(mid, mid + 6), s.slice(Math.max(0, mid - 6), mid)];
}

/** 텍스트 한 줄로 만든 후보: 줄 전체 → 앞에서부터 8글자씩 */
export function acrossLine(line: string): string[] {
  const s = squash(line);
  const windows: string[] = [];
  for (let i = 0; i + 4 <= s.length; i += 4) windows.push(s.slice(i, i + 8));
  return [s, ...windows];
}

/**
 * 원본에서 누른 자리의 글자 조각(`probes`, 앞의 것일수록 우선)이 들어 있는 문장을 찾아 그 줄에 포커스를 준다.
 * 누른 자리가 두 문장에 걸칠 수 있어 여러 조각을 차례로 시도한다.
 * `near`를 만족하는 줄(같은 쪽·같은 범위)을 먼저 찾고, 없으면 전체에서 찾는다.
 */
export function jumpToSnippet(probeList: string[], near: (section: Section, block: Block) => boolean): boolean {
  const probes = probeList.map(squash).filter((p) => p.length >= 2);
  if (!probes.length) return false;

  for (const nearOnly of [true, false]) {
    for (const probe of probes) {
      for (let si = 0; si < scenario.sections.length; si++) {
        const section = scenario.sections[si];
        for (const block of section.blocks) {
          if (block.type !== "sentence" || (nearOnly && !near(section, block))) continue;
          if (!squash(block.text).includes(probe)) continue;
          scenario.activeIndex = si;
          focusBlock(block.id);
          return true;
        }
      }
    }
  }
  return false;
}
