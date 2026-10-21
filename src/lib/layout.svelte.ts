// 화면 배치 설정 (패널 열림/닫힘, 위치, 크기). 바뀌면 자동으로 저장해 다음 실행 때도 유지한다.

const KEY = "trpg.layout";

/** 복사 페이지에서 시나리오 패널과 매크로 패널을 어떻게 놓을지 */
export type CopyArrangement = "scenario-left" | "macros-left" | "scenario-top" | "macros-top";

interface Saved {
  alwaysOnTop: boolean;
  sectionsOpen: boolean;
  rulesOpen: boolean;
  editorSwap: boolean;
  viewerOpen: boolean;
  viewerSide: "left" | "right";
  viewerWidth: number;
  viewerSync: boolean;
  copyArrangement: CopyArrangement;
  macroSize: number;
  showScenario: boolean;
  showMacros: boolean;
  copyUnquote: boolean;
}

const DEFAULTS: Saved = {
  alwaysOnTop: false,
  sectionsOpen: true,
  rulesOpen: true,
  editorSwap: false,
  viewerOpen: false,
  viewerSide: "right",
  viewerWidth: 520,
  viewerSync: true,
  copyArrangement: "scenario-left",
  macroSize: 400,
  showScenario: true,
  showMacros: true,
  copyUnquote: false,
};

function load(): Saved {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return DEFAULTS;
  }
}

class Layout {
  /** 다른 창을 눌러도 이 창이 뒤로 가려지지 않게 맨 위에 고정 */
  alwaysOnTop = $state(DEFAULTS.alwaysOnTop);

  // 편집 페이지
  sectionsOpen = $state(DEFAULTS.sectionsOpen);
  rulesOpen = $state(DEFAULTS.rulesOpen);
  /** true면 이름 치환 패널이 왼쪽, 집합 목록이 오른쪽 */
  editorSwap = $state(DEFAULTS.editorSwap);
  /** 원본(PDF/텍스트) 뷰어: 열림, 문장 목록의 어느 쪽에 둘지, 너비, 목록과 연동할지 */
  viewerOpen = $state(DEFAULTS.viewerOpen);
  viewerSide = $state<"left" | "right">(DEFAULTS.viewerSide);
  viewerWidth = $state(DEFAULTS.viewerWidth);
  viewerSync = $state(DEFAULTS.viewerSync);

  // 복사 페이지
  copyArrangement = $state<CopyArrangement>(DEFAULTS.copyArrangement);
  /** 매크로 패널 크기 (좌우 배치면 너비, 상하 배치면 높이, px) */
  macroSize = $state(DEFAULTS.macroSize);
  showScenario = $state(DEFAULTS.showScenario);
  showMacros = $state(DEFAULTS.showMacros);
  /** 대사 카드를 복사할 때 바깥 따옴표를 뺄지 */
  copyUnquote = $state(DEFAULTS.copyUnquote);

  constructor() {
    Object.assign(this, load());
    $effect.root(() => {
      $effect(() => {
        const saved: Saved = {
          alwaysOnTop: this.alwaysOnTop,
          sectionsOpen: this.sectionsOpen,
          rulesOpen: this.rulesOpen,
          editorSwap: this.editorSwap,
          viewerOpen: this.viewerOpen,
          viewerSide: this.viewerSide,
          viewerWidth: this.viewerWidth,
          viewerSync: this.viewerSync,
          copyArrangement: this.copyArrangement,
          macroSize: this.macroSize,
          showScenario: this.showScenario,
          showMacros: this.showMacros,
          copyUnquote: this.copyUnquote,
        };
        try {
          localStorage.setItem(KEY, JSON.stringify(saved));
        } catch {
          // 저장 실패는 무시
        }
      });
    });
  }
}

export const layout = new Layout();
