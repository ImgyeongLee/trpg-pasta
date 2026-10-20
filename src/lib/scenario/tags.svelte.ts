// 그룹 태그: 프리셋(핸드아웃·성공 판정·실패 판정·GM 정보) + 사람이 만든 태그(이름·색).
// 만든 태그는 이 컴퓨터(localStorage)에 두고, 세이브 파일에도 쓰인 것만 함께 넣어 다른 곳에서 열어도 보이게 한다.

export interface GroupTag {
  id: string;
  name: string;
  /** #rrggbb */
  color: string;
  preset?: boolean;
  /** GM만 보는 태그: 이 태그가 붙은 그룹은 복사되지 않고 텍스트 내보내기에서도 빠진다 (GM용으로 뽑을 때만 ※ GM:) */
  secret?: boolean;
}

export const PRESET_TAGS: GroupTag[] = [
  { id: "handout", name: "핸드아웃", color: "#e2b100", preset: true },
  { id: "success", name: "성공 판정", color: "#78c43a", preset: true },
  { id: "failure", name: "실패 판정", color: "#ee6fa0", preset: true },
  { id: "gm", name: "GM 정보", color: "#3b82d6", preset: true, secret: true },
];

/** 핸드아웃 태그 id (채팅 매크로 아래에 모아 보이는 태그) */
export const HANDOUT_TAG = "handout";

/** GM 정보 태그 id */
export const GM_TAG = "gm";

/** 새 태그에 고를 수 있는 색 */
export const TAG_SWATCHES = ["#e2b100", "#78c43a", "#ee6fa0", "#f08a3c", "#e5534b", "#2fb3a3", "#3d8bfd", "#9b7be0", "#a8806a", "#8a939b"];

export const isHexColor = (v: string) => /^#[0-9a-f]{6}$/i.test(v);

const KEY = "trpg.groupTags";

function load(): GroupTag[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((t) => t && typeof t.id === "string" && typeof t.name === "string" && isHexColor(t.color)) : [];
  } catch {
    return [];
  }
}

class TagStore {
  custom = $state<GroupTag[]>(load());
  all = $derived([...PRESET_TAGS, ...this.custom]);

  get(id: string | undefined): GroupTag | undefined {
    return id ? this.all.find((t) => t.id === id) : undefined;
  }

  add(name: string, color: string): string {
    const tag: GroupTag = { id: `t-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: name.trim(), color };
    this.custom.push(tag);
    this.#save();
    return tag.id;
  }

  update(id: string, patch: { name?: string; color?: string }) {
    const tag = this.custom.find((t) => t.id === id);
    if (!tag) return;
    if (patch.name?.trim()) tag.name = patch.name.trim();
    if (patch.color && isHexColor(patch.color)) tag.color = patch.color;
    this.#save();
  }

  /** 태그를 지운다. 이 태그가 붙어 있던 그룹은 「태그 없음」으로 보인다. */
  remove(id: string) {
    this.custom = this.custom.filter((t) => t.id !== id);
    this.#save();
  }

  /** 세이브 파일에 들어 있던 태그 중 이 컴퓨터에 없는 것을 더한다. */
  adopt(tags: GroupTag[] | undefined) {
    let changed = false;
    for (const t of tags ?? []) {
      if (this.get(t.id) || !t.name || !isHexColor(t.color)) continue;
      this.custom.push({ id: t.id, name: t.name, color: t.color });
      changed = true;
    }
    if (changed) this.#save();
  }

  #save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.custom));
    } catch {
      // 저장 실패는 무시 (이번 실행 동안은 그대로 쓴다)
    }
  }
}

export const tags = new TagStore();

/** GM만 보는 그룹인지 (복사·내보내기에서 빠짐) */
export function isSecret(block: { type: string; tag?: string }): boolean {
  return block.type === "group" && !!tags.get(block.tag)?.secret;
}
