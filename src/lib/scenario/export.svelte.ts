// 정리 결과를 텍스트로 만든다. 그림이 있던 자리에는 [그림 03 · 12쪽] 같은 표시를 넣고,
// 그림 파일 이름(그림03_12쪽.png)도 같은 번호를 쓴다.

import { invoke } from "@tauri-apps/api/core";
import { scenario } from "./state.svelte";
import { isSecret, tags } from "./tags.svelte";
import type { GroupBlock, ImageBlock, SentenceBlock } from "./types";

function pad(n: number) {
  return String(n).padStart(Math.max(2, String(scenario.imageNumbers.size).length), "0");
}

export function imageFileName(block: ImageBlock): string {
  const n = scenario.imageNumbers.get(block.id) ?? 0;
  return `그림${pad(n)}${block.page ? `_${block.page}쪽` : ""}.png`;
}

export function imagePlaceholder(block: ImageBlock): string {
  const n = scenario.imageNumbers.get(block.id) ?? 0;
  // 텍스트 시나리오의 [이미지: …] 자리표시자는 원래 설명을 살린다.
  if (!block.imageId && block.caption) return `[그림 ${pad(n)}: ${block.caption.replace(/^[[(<【〈《]\s*|\s*[\])>】〉》]$/g, "")}]`;
  return `[그림 ${pad(n)}${block.page ? ` · ${block.page}쪽` : ""}]`;
}

export interface TextExportOptions {
  /** 이름 치환(탐사자 → 캐릭터 이름, 조사 교정) 적용 */
  substitute: boolean;
  /** GM 메모(문장 아래 ※)와 GM 정보 그룹(※ GM:)을 넣기. 끄면 둘 다 빠진다. */
  notes: boolean;
  /** 제목·항목 앞에 빈 줄 */
  blankBeforeHeadings: boolean;
  /** 화자를 정한 대사 앞에 「화자: 」 붙이기 */
  speakers: boolean;
}

export async function buildText(options: TextExportOptions): Promise<string> {
  const sentences = scenario.sections.flatMap((s) => s.blocks.filter((b): b is SentenceBlock | GroupBlock => b.type !== "image"));
  let texts = sentences.map((b) => b.text);
  if (options.substitute) {
    texts = await invoke<string[]>("apply_substitutions", { texts, rules: $state.snapshot(scenario.rules) });
  }
  const finalText = new Map(sentences.map((b, i) => [b.id, texts[i]]));

  const lines: string[] = [];
  for (const section of scenario.sections) {
    for (const block of section.blocks) {
      if (isSecret(block) && block.type === "group") {
        // GM 정보 그룹은 플레이어에게 내보내지 않는다. GM용으로 뽑을 때만 줄마다 표시해서 넣는다.
        if (options.notes) for (const line of block.text.split("\n")) if (line.trim()) lines.push(`※ GM: ${line}`);
      } else if (block.type === "group") {
        // 그룹은 앞뒤에 빈 줄을 두어 한 덩어리로 보이게 한다. GM용으로 뽑을 때는 태그·제목을 위에 적는다.
        if (lines.length && lines[lines.length - 1] !== "") lines.push("");
        const tag = tags.get(block.tag)?.name;
        if (options.notes && (tag || block.title)) lines.push(`※ ${[tag, block.title].filter(Boolean).join(": ")}`);
        lines.push(...(finalText.get(block.id) ?? block.text).split("\n"), "");
      } else if (block.type === "sentence") {
        if (block.kind === "heading" && options.blankBeforeHeadings && lines.length && lines[lines.length - 1] !== "") lines.push("");
        const line = finalText.get(block.id) ?? block.text;
        lines.push(options.speakers && block.speaker ? `${block.speaker}: ${line}` : line);
      } else {
        lines.push(imagePlaceholder(block));
      }
      if (options.notes && block.note?.trim()) {
        for (const note of block.note.trim().split("\n")) lines.push(`    ※ ${note}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

/** 원래 파일 이름에서 확장자를 떼고 「(정리)」를 붙인다. */
export function exportBaseName(): string {
  const name = scenario.sourceName ?? "시나리오";
  return name.replace(/\.(pdf|txt|md|text)$/i, "");
}
