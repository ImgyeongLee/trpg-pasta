// 채팅 매크로 저장소. 앱 데이터 폴더의 macros.json에 자동 저장된다 (Rust: load_data / save_data).

import { invoke } from "@tauri-apps/api/core";

export interface Macro {
  id: string;
  name: string;
  /** 템플릿 본문. {변수}, {변수:선택1/선택2} */
  body: string;
  group: string;
  /** 마지막으로 쓴 변수 값 */
  values: Record<string, string>;
}

interface Stored {
  version: 1;
  groups: string[];
  macros: Macro[];
}

const STORE = "macros";

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function defaults(): Stored {
  const m = (group: string, name: string, body: string): Macro => ({ id: newId(), name, body, group, values: {} });
  return {
    version: 1,
    groups: ["판정", "텍스트 꾸미기"],
    macros: [
      m("판정", "기능 판정", "CC<={수치} 【{기능:관찰력/듣기/도서관 이용/심리학/회피/설득}】"),
      m("판정", "관련 판정", "{관련} 판정"),
      m("판정", "이성 판정", "CC<={이성} 【이성 판정】"),
      m("판정", "주사위", "{개수}d{면:4/6/8/10/20/100}"),
      m("텍스트 꾸미기", "구분선", "━━━━━━━━━━━━━━━━━━━━"),
      m("텍스트 꾸미기", "장면 전환", "── ✦ {장면} ✦ ──"),
      m("텍스트 꾸미기", "강조", "【{내용}】"),
      m("텍스트 꾸미기", "시스템 안내", "［SYSTEM］ {안내}"),
    ],
  };
}

class MacroState {
  groups = $state<string[]>([]);
  macros = $state<Macro[]>([]);
  loaded = $state(false);
  error = $state<string | null>(null);

  #loading: Promise<void> | null = null;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    // 불러온 뒤의 모든 변경을 잠시 모았다가 파일로 저장한다.
    $effect.root(() => {
      $effect(() => {
        if (!this.loaded) return;
        const contents = JSON.stringify({ version: 1, groups: this.groups, macros: this.macros } satisfies Stored, null, 2);
        clearTimeout(this.#timer);
        this.#timer = setTimeout(() => {
          invoke("save_data", { name: STORE, contents }).then(
            () => (this.error = null),
            (e) => (this.error = `매크로 저장 실패: ${e}`),
          );
        }, 300);
      });
    });
  }

  load(): Promise<void> {
    this.#loading ??= (async () => {
      let data: Stored = defaults();
      try {
        const raw = await invoke<string | null>("load_data", { name: STORE });
        if (raw) data = JSON.parse(raw) as Stored;
      } catch (e) {
        this.error = `매크로를 불러오지 못했습니다: ${e}`;
      }
      // 그룹 목록에 없는 그룹을 가진 매크로도 보이도록 보정한다.
      const groups = [...data.groups];
      for (const m of data.macros) if (!groups.includes(m.group)) groups.push(m.group);
      this.groups = groups;
      this.macros = data.macros.map((m) => ({ ...m, values: m.values ?? {} }));
      this.loaded = true;
    })();
    return this.#loading;
  }

  inGroup(group: string): Macro[] {
    return this.macros.filter((m) => m.group === group);
  }

  add(group: string): string {
    const macro: Macro = { id: newId(), name: "새 매크로", body: "", group, values: {} };
    this.macros.push(macro);
    return macro.id;
  }

  remove(id: string) {
    this.macros = this.macros.filter((m) => m.id !== id);
  }

  /** 같은 그룹 안에서 앞/뒤 매크로와 자리를 바꾼다. */
  move(id: string, step: 1 | -1) {
    const macro = this.macros.find((m) => m.id === id);
    if (!macro) return;
    const siblings = this.macros.filter((m) => m.group === macro.group);
    const target = siblings[siblings.indexOf(macro) + step];
    if (!target) return;
    const a = this.macros.indexOf(macro);
    const b = this.macros.indexOf(target);
    [this.macros[a], this.macros[b]] = [this.macros[b], this.macros[a]];
  }

  addGroup(): string {
    let name = "새 그룹";
    for (let i = 2; this.groups.includes(name); i++) name = `새 그룹 ${i}`;
    this.groups.push(name);
    return name;
  }

  renameGroup(from: string, to: string) {
    const name = to.trim();
    if (!name || name === from || this.groups.includes(name)) return false;
    this.groups = this.groups.map((g) => (g === from ? name : g));
    for (const m of this.macros) if (m.group === from) m.group = name;
    return true;
  }

  /** 그룹과 그 안의 매크로를 함께 지운다. */
  removeGroup(name: string) {
    this.groups = this.groups.filter((g) => g !== name);
    this.macros = this.macros.filter((m) => m.group !== name);
  }
}

export const macros = new MacroState();
