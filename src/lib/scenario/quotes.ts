// 대사 따옴표 떼기 (복사 페이지 「따옴표 빼고 복사」).

const PAIRS: Record<string, string> = { '"': '"', "“": "”", "「": "」", "『": "』", "'": "'", "‘": "’" };

/**
 * 줄 전체가 따옴표 한 쌍으로 감싸여 있으면 바깥 따옴표를 뗀다.
 * `"안녕." 그가 말했다.`나 `“가” 하고 “나”`처럼 따옴표가 중간에 닫히는 줄은 그대로 둔다.
 */
export function unquote(text: string): string {
  const t = text.trim();
  const close = PAIRS[t[0]];
  if (!close || t.length < 2 || t[t.length - 1] !== close) return text;
  const inner = t.slice(1, -1);
  if (inner.includes(close)) return text;
  return inner.trim();
}
