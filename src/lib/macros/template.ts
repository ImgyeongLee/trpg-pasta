// 매크로 템플릿: 본문 속 {변수}는 입력칸, {변수:선택1/선택2}는 선택 버튼이 된다.
// 같은 이름의 변수가 여러 번 나오면 같은 값으로 채운다.

export interface TemplateVar {
  name: string;
  choices: string[];
}

export type Segment = { text: string } | { var: string };

const PLACEHOLDER = /\{([^{}\n]+)\}/g;

function parseSpec(spec: string): TemplateVar {
  const i = spec.indexOf(":");
  if (i < 0) return { name: spec.trim(), choices: [] };
  const choices = spec
    .slice(i + 1)
    .split("/")
    .map((c) => c.trim())
    .filter(Boolean);
  return { name: spec.slice(0, i).trim(), choices };
}

export function parseVars(body: string): TemplateVar[] {
  const vars = new Map<string, TemplateVar>();
  for (const m of body.matchAll(PLACEHOLDER)) {
    const v = parseSpec(m[1]);
    if (!v.name) continue;
    const prev = vars.get(v.name);
    if (!prev) vars.set(v.name, v);
    else if (!prev.choices.length && v.choices.length) prev.choices = v.choices;
  }
  return [...vars.values()];
}

export function segments(body: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of body.matchAll(PLACEHOLDER)) {
    const name = parseSpec(m[1]).name;
    if (!name) continue;
    if (m.index > last) out.push({ text: body.slice(last, m.index) });
    out.push({ var: name });
    last = m.index + m[0].length;
  }
  if (last < body.length) out.push({ text: body.slice(last) });
  return out;
}

export function render(body: string, values: Record<string, string>): string {
  return segments(body)
    .map((s) => ("text" in s ? s.text : (values[s.var] ?? "")))
    .join("");
}

/** 아직 값이 비어 있는 변수 이름 */
export function missing(body: string, values: Record<string, string>): string[] {
  return parseVars(body)
    .map((v) => v.name)
    .filter((name) => !values[name]?.trim());
}
