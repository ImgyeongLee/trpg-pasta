// 정리된 문장 ↔ 원본 위치를 잇는 글자 맞추기.
// 원본과 정리본은 공백·줄바꿈이 달라질 수 있어서 공백을 모두 빼고 비교한다.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 원본의 글자 조각 하나와 그 영역 (PDF: 쪽 좌표 / 텍스트: 줄 번호를 y로) */
export interface Piece {
  str: string;
  rect: Rect;
}

export const squash = (s: string) => s.replace(/\s+/g, "");

interface Joined {
  text: string;
  /** text의 각 글자가 몇 번째 조각의 몇 번째 글자인지 */
  owner: number[];
  offset: number[];
  lengths: number[];
}

export function join(pieces: Piece[]): Joined {
  let text = "";
  const owner: number[] = [];
  const offset: number[] = [];
  const lengths: number[] = [];
  pieces.forEach((p, i) => {
    const t = squash(p.str);
    lengths.push(t.length);
    for (let k = 0; k < t.length; k++) {
      owner.push(i);
      offset.push(k);
    }
    text += t;
  });
  return { text, owner, offset, lengths };
}

/** 문장 앞부분으로 위치를 찾는다. 앞부분이 고쳐졌을 수 있어 점점 짧게 다시 시도한다. */
export function locate(joined: string, sentence: string, from = 0): { start: number; end: number } | null {
  const target = squash(sentence);
  if (target.length < 2) return null;
  for (const n of [24, 12, 6]) {
    const probe = target.slice(0, n);
    if (probe.length < Math.min(n, target.length)) continue;
    let start = joined.indexOf(probe, from);
    if (start < 0 && from > 0) start = joined.indexOf(probe);
    if (start >= 0) return { start, end: Math.min(joined.length, start + target.length) - 1 };
  }
  return null;
}

/** 같은 줄(높이가 비슷한)의 영역을 하나로 합친다. 양쪽 정렬로 단어 사이가 벌어진 줄도 한 덩어리로 칠한다. */
export function mergeLines(rects: Rect[]): Rect[] {
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
  const out: Rect[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.y - r.y) < Math.max(last.h, r.h) * 0.5) {
      const x = Math.min(last.x, r.x);
      const y = Math.min(last.y, r.y);
      last.w = Math.max(last.x + last.w, r.x + r.w) - x;
      last.h = Math.max(last.y + last.h, r.y + r.h) - y;
      last.x = x;
      last.y = y;
    } else {
      out.push({ ...r });
    }
  }
  return out;
}

/**
 * 쪽 안에서 문장이 차지하는 영역. 조각 일부만 해당하면 글자 비율로 잘라 낸다.
 * 실제로 글자가 맞는 데까지만 칠하고(쪽 끝에서 잘린 문장이 쪽수·바닥글까지 번지지 않게),
 * `consumed`로 이 쪽에서 맞춘 글자 수를 알려 준다 — 나머지는 다음 쪽에서 이어 찾는다.
 */
export function sentenceRects(pieces: Piece[], sentence: string, atStart = false): { rects: Rect[]; consumed: number } {
  const j = join(pieces);
  const target = squash(sentence);
  const hit = atStart ? (j.text.startsWith(target.slice(0, 6)) ? { start: 0 } : null) : locate(j.text, sentence);
  if (!hit || !target) return { rects: [], consumed: 0 };
  // 맞는 글자까지 앞으로 나아간다.
  let k = hit.start;
  let t = 0;
  while (k < j.text.length && t < target.length && j.text[k] === target[t]) {
    k++;
    t++;
  }
  let end = k - 1;
  // 중간을 고친 문장: 끝부분이 가까이 있으면 거기까지 이어 칠한다.
  if (t < target.length && target.length > 12) {
    const tail = target.slice(-12);
    const tk = j.text.indexOf(tail, k);
    if (tk >= 0 && tk + tail.length - hit.start <= target.length * 1.3) {
      end = tk + tail.length - 1;
      t = target.length;
    }
  }
  if (end < hit.start) return { rects: [], consumed: 0 };
  const parts = new Map<number, [number, number]>();
  for (let i = hit.start; i <= end; i++) {
    const owner = j.owner[i];
    const range = parts.get(owner);
    if (range) range[1] = j.offset[i];
    else parts.set(owner, [j.offset[i], j.offset[i]]);
  }
  const rects: Rect[] = [];
  for (const [i, [a, b]] of parts) {
    const r = pieces[i].rect;
    const len = j.lengths[i] || 1;
    rects.push({ x: r.x + (r.w * a) / len, y: r.y, w: (r.w * (b - a + 1)) / len, h: r.h });
  }
  return { rects: mergeLines(rects), consumed: t };
}

/** (x, y)를 눌렀을 때 그 자리 앞뒤 글자 몇 개 (공백 제외). 아무 글자도 없으면 null. */
export function snippetAt(pieces: Piece[], x: number, y: number, radius = 6): string | null {
  const pad = 2;
  const i = pieces.findIndex(
    (p) => x >= p.rect.x - pad && x <= p.rect.x + p.rect.w + pad && y >= p.rect.y - pad && y <= p.rect.y + p.rect.h + pad,
  );
  if (i < 0) return null;
  const j = join(pieces);
  const r = pieces[i].rect;
  const len = j.lengths[i];
  if (!len) return null;
  const within = Math.min(len - 1, Math.max(0, Math.floor(((x - r.x) / Math.max(1, r.w)) * len)));
  const k = j.owner.indexOf(i) + within;
  return j.text.slice(Math.max(0, k - radius), k + radius);
}
