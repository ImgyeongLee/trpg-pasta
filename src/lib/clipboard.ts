import { writeImage, writeText } from "@tauri-apps/plugin-clipboard-manager";

export async function copyText(text: string) {
  try {
    await writeText(text);
  } catch {
    await navigator.clipboard.writeText(text);
  }
}

/** blob URL의 PNG 이미지를 클립보드로 복사한다. */
export async function copyImage(url: string) {
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  await writeImage(bytes);
}
