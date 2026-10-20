import { getCurrentWindow } from "@tauri-apps/api/window";

/** 창을 항상 맨 위에 둘지 정한다. 데스크탑 앱이 아닐 때(브라우저)는 조용히 넘어간다. */
export async function setAlwaysOnTop(on: boolean) {
  try {
    await getCurrentWindow().setAlwaysOnTop(on);
  } catch (e) {
    console.warn("항상 위에 고정을 적용하지 못했습니다:", e);
  }
}
