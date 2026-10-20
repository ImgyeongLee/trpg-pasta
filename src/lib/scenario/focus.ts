import { tick } from "svelte";
import { editor } from "./editor/api.svelte";

/** 편집기에서 그 줄로 이동해 커서를 둔다 (caret이 없으면 줄 끝). 집합을 옮긴 직후여도 편집기가 뜨면 이동한다. */
export async function focusBlock(id: number, caret?: number) {
  await tick();
  editor.focus(id, caret);
}
