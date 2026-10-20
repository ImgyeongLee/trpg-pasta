import { invoke } from "@tauri-apps/api/core";
import { SvelteMap } from "svelte/reactivity";
import { extractPage, openPdf, recropImages, sha256 } from "./pdf";
import { GM_TAG, isSecret, tags } from "./tags.svelte";
import type {
  Block,
  Crop,
  SaveFile,
  SavedBlock,
  Carry,
  ChunkOutput,
  GroupBlock,
  LabelCount,
  PdfPageInput,
  ProcessOptions,
  RawBlock,
  Section,
  SentenceBlock,
  SentenceKind,
  Stats,
  StoredImage,
  SubstitutionRule,
} from "./types";

export type Filter = "all" | "dialogue" | "gm" | "warning" | "image" | "group" | "note";
export type Status = "idle" | "processing" | "done" | "cancelled" | "error";

const OPTIONS_KEY = "trpg.scenario.options";
const RULES_KEY = "trpg.scenario.rules";

/** 긴 시나리오는 처음 집합을 작게 잡아 빨리 보여주고, 이후로는 크게 묶는다. */
const PDF_FIRST_CHUNK = 3;
const PDF_CHUNK = 8;
const TEXT_FIRST_CHUNK = 150;
const TEXT_CHUNK = 600;

export const ELLIPSIS_RE = /\.{2,}|[…‥⋯]|\.(?: \.){2,}|。{2,}/;

const DEFAULT_OPTIONS: ProcessOptions = {
  splitOnEllipsis: false,
  joinLinesWithoutSpace: false,
  removePageNumbers: true,
  removeHeaders: true,
};

let seq = 0;
const nextId = () => ++seq;

function defaultRules(): SubstitutionRule[] {
  return [
    { id: nextId(), label: "탐사자", name: "", batchim: "auto" },
    { id: nextId(), label: "PC", name: "", batchim: "auto" },
    { id: nextId(), label: "KPC", name: "", batchim: "auto" },
  ];
}

function load<T>(key: string, fallback: () => T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T;
  } catch {
    // 저장소를 못 쓰면 기본값으로 시작한다.
  }
  return fallback();
}

export function save(key: "options" | "rules", value: unknown) {
  try {
    localStorage.setItem(key === "options" ? OPTIONS_KEY : RULES_KEY, JSON.stringify(value));
  } catch {
    // 저장 실패는 무시 (다음 실행 때 기본값)
  }
}

function hydrate(raw: RawBlock): Block {
  return { ...raw, id: nextId(), used: false };
}

/** 따옴표로 시작하면 대사, 아니면 서술 (편집기에서 새로 생긴 줄의 종류) */
export function guessKind(text: string): SentenceKind {
  return /^\s*["“「『'‘]/.test(text) ? "dialogue" : "narration";
}

/** 편집기에서 새 줄이 생겼을 때 쓸 블록 id */
export const newBlockId = () => nextId();

/** 편집기에서 새로 생긴 줄 → 블록 */
export function makeSentence(id: number, text: string, page: number | null): SentenceBlock {
  return { type: "sentence", id, text, kind: guessKind(text), hasEllipsis: ELLIPSIS_RE.test(text), warnings: [], page, used: false };
}

export const newSessionId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** 세이브용으로 블록을 줄인다 (기본값은 빼고 짧은 키로) */
function packBlock(b: Block): SavedBlock {
  const o: SavedBlock = { t: b.type === "sentence" ? "s" : b.type === "group" ? "g" : "i" };
  if (b.type === "sentence") {
    o.x = b.text;
    if (b.kind !== "narration") o.k = ({ dialogue: "d", heading: "h" } as const)[b.kind];
    if (b.warnings.length) o.w = b.warnings;
  } else if (b.type === "group") {
    o.x = b.text;
    if (b.title) o.ti = b.title;
    if (b.tag) o.tg = b.tag;
  } else {
    if (b.imageId) o.im = b.imageId;
    if (b.caption) o.c = b.caption;
  }
  if (b.page != null) o.p = b.page;
  if (b.used) o.u = 1;
  if (b.note) o.n = b.note;
  if (b.speaker) o.s = b.speaker;
  return o;
}

function unpackBlock(o: SavedBlock): Block {
  const common = { id: nextId(), page: o.p ?? null, used: !!o.u, note: o.n, speaker: o.s };
  if (o.t === "i") return { type: "image", imageId: o.im ?? null, caption: o.c ?? null, ...common };
  if (o.t === "g" || o.t === "h") return { type: "group", text: o.x ?? "", title: o.ti, tag: o.t === "h" ? "handout" : o.tg, ...common };
  const text = o.x ?? "";
  return {
    type: "sentence",
    text,
    kind: o.k === "d" ? "dialogue" : o.k === "h" ? "heading" : "narration",
    hasEllipsis: ELLIPSIS_RE.test(text),
    warnings: o.w ?? [],
    ...common,
  };
}

/**
 * 세이브 속 블록들을 되살린다. 예전 세이브의 「GM 정보」 줄(k: "g")은 이어진 것끼리 GM 정보 그룹 하나로 묶는다.
 */
function unpackBlocks(saved: SavedBlock[]): Block[] {
  const out: Block[] = [];
  let legacyGm: GroupBlock | null = null;
  for (const o of saved) {
    if (o.t === "s" && o.k === "g") {
      const text = o.x ?? "";
      if (legacyGm && !o.n && !o.s) {
        legacyGm.text += `\n${text}`;
        continue;
      }
      legacyGm = { type: "group", id: nextId(), text, tag: GM_TAG, page: o.p ?? null, used: false, note: o.n, speaker: o.s };
      out.push(legacyGm);
      continue;
    }
    legacyGm = null;
    out.push(unpackBlock(o));
  }
  return out;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function emptyStats(): Stats {
  return { removedPageNumbers: 0, removedHeaders: 0, pagesWithoutText: [] };
}

function decodeText(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^﻿/, "");
  } catch {
    // 한국어 텍스트 파일은 CP949(EUC-KR)인 경우가 많다.
    return new TextDecoder("euc-kr").decode(buffer);
  }
}

/** 텍스트 줄을 집합으로 나눈다. 가능하면 빈 줄(문단 경계)에서 자른다. */
function chunkLines(lines: string[]): [number, number][] {
  const chunks: [number, number][] = [];
  let start = 0;
  while (start < lines.length) {
    const size = chunks.length === 0 ? TEXT_FIRST_CHUNK : TEXT_CHUNK;
    let end = Math.min(lines.length, start + size);
    if (end < lines.length) {
      const limit = Math.min(lines.length, end + 100);
      let cut = end;
      while (cut < limit && lines[cut].trim() !== "") cut++;
      if (cut < limit) end = cut + 1;
    }
    chunks.push([start, end]);
    start = end;
  }
  return chunks;
}

/** 되돌리기 기록: 집합 안의 줄 상태, 지운·합친·나눈·만든 집합, 바꾼 이름 */
type UndoEntry =
  | { kind: "blocks"; sectionId: number; blocks: Block[] }
  | { kind: "section"; section: Section; index: number }
  | { kind: "merge"; mergedId: number; first: Section; second: Section }
  | { kind: "split"; original: Section; newId: number }
  | { kind: "add"; id: number }
  | { kind: "rename"; id: number; label: string };

/**
 * 집합 크기: 한 집합이 너무 크면 열 때 느리고 검증하기도 버겁다.
 * 정리 결과가 SECTION_MAX줄을 넘으면 SECTION_TARGET줄 안팎으로 나누되, 제목 줄 앞이나 쪽이 바뀌는 곳을 먼저 찾는다.
 */
const SECTION_MIN = 100;
const SECTION_TARGET = 180;
const SECTION_MAX = 250;

export function splitBlocks(blocks: Block[]): Block[][] {
  if (blocks.length <= SECTION_MAX) return [blocks];
  const parts: Block[][] = [];
  let start = 0;
  while (blocks.length - start > SECTION_MAX) {
    const remaining = blocks.length - start;
    // 남은 양이 조금만 넘치면 반씩 나눠 너무 작은 꼬리가 생기지 않게 한다.
    const target = start + (remaining <= SECTION_TARGET * 2 ? Math.round(remaining / 2) : SECTION_TARGET);
    const lo = start + SECTION_MIN;
    const hi = Math.min(start + SECTION_MAX, blocks.length - SECTION_MIN);
    const nearest = (ok: (i: number) => boolean) => {
      let best = -1;
      for (let i = lo; i <= hi; i++) if (ok(i) && (best < 0 || Math.abs(i - target) < Math.abs(best - target))) best = i;
      return best;
    };
    let cut = nearest((i) => blocks[i].type === "sentence" && (blocks[i] as SentenceBlock).kind === "heading");
    if (cut < 0) cut = nearest((i) => blocks[i].page != null && blocks[i].page !== blocks[i - 1].page);
    if (cut < 0) cut = target;
    parts.push(blocks.slice(start, cut));
    start = cut;
  }
  parts.push(blocks.slice(start));
  return parts;
}

/** 쪽 번호가 있는 줄들의 범위로 이름을 붙인다 (예: 4–7쪽) */
function pageLabel(blocks: Block[]): string | null {
  const pages = blocks.map((b) => b.page).filter((p): p is number => p != null);
  if (!pages.length) return null;
  const from = Math.min(...pages);
  const to = Math.max(...pages);
  return from === to ? `${from}쪽` : `${from}–${to}쪽`;
}

/** 자동으로 붙은 이름인지 (사람이 바꾼 이름은 나눌 때 그대로 살린다) */
const AUTO_LABEL = /^\d+(–\d+)?(쪽|줄)( \(\d+\))?$/;

const nextFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** 원본 보기용 원문. PDF는 바이트, 텍스트는 원문 그대로. */
export type Source = { kind: "pdf"; bytes: Uint8Array } | { kind: "text"; text: string; gdocId?: string };

class ScenarioState {
  sourceName = $state<string | null>(null);
  /** 원본 뷰어가 쓰는 원문 (큰 데이터라 깊은 반응형으로 만들지 않는다) */
  source = $state.raw<Source | null>(null);
  /** 검증 화면에서 마지막으로 누르거나 편집한 줄 — 원본 뷰어가 이 줄을 따라간다 */
  focusedId = $state<number | null>(null);
  /** 새 시나리오를 불러올 때마다 늘어난다 (세이브에서 연 경우는 제외) — 「아직 저장 안 함」 상태로 되돌리는 신호 */
  freshLoads = $state(0);
  /** 저장에 쓰는 작업 id (시나리오를 불러오거나 세이브를 열 때 정해진다) */
  sessionId = $state<string | null>(null);
  /** 원본 PDF의 지문 (세이브를 다시 열 때 같은 PDF인지 확인) */
  pdfInfo = $state.raw<{ size: number; sha256: string } | null>(null);
  /** 세이브에서 열었는데 원본 PDF가 아직 연결되지 않았는지 (그림·원본 보기가 비어 있음) */
  missingPdf = $derived(this.pdfInfo !== null && this.source === null);
  status = $state<Status>("idle");
  error = $state<string | null>(null);
  progress = $state({ done: 0, total: 0, unit: "쪽" });
  stats = $state<Stats>(emptyStats());

  sections = $state<Section[]>([]);
  activeIndex = $state(0);
  showPreview = $state(true);

  options = $state<ProcessOptions>({ ...DEFAULT_OPTIONS, ...load(OPTIONS_KEY, () => ({})) });
  rules = $state<SubstitutionRule[]>(load(RULES_KEY, defaultRules));
  detected = $state<LabelCount[]>([]);
  /** 블록 id → 이름 치환 결과 (현재 집합) */
  substituted = $state<Record<number, string>>({});

  canUndo = $state(false);


  /** 잘라낸 그림 (blob URL). 세이브를 열고 원본 PDF를 다시 연결하면 채워지므로 반응형으로 둔다. */
  images = new SvelteMap<string, StoredImage>();
  /** 그림 id → PDF 속 위치. 원본 없이 세이브를 열었을 때도 다시 자를 수 있게 따로 들고 있는다. */
  #crops = new Map<string, Crop>();

  #abort: AbortController | null = null;
  #undo: UndoEntry[] = [];

  active = $derived(this.sections[this.activeIndex] as Section | undefined);

  /** 전체 줄 수 */
  total = $derived(this.sections.reduce((n, s) => n + s.blocks.length, 0));

  /** 그림 블록 id → 시나리오 전체에서의 번호 (나온 순서, 1부터). 텍스트의 [그림 03]과 파일 이름이 같은 번호를 쓴다. */
  imageNumbers = $derived.by(() => {
    const numbers = new Map<number, number>();
    for (const s of this.sections) for (const b of s.blocks) if (b.type === "image") numbers.set(b.id, numbers.size + 1);
    return numbers;
  });

  /** 시나리오 전체의 그룹 (나온 순서). 태그가 붙은 그룹은 복사 페이지의 매크로 패널 아래에 모아 보인다. */
  groups = $derived(this.sections.flatMap((s) => s.blocks.filter((b): b is GroupBlock => b.type === "group")));

  /** 그룹 블록 id → 이름 (태그 이름 + 그 태그 안의 번호, 예: 핸드아웃 2 / 태그가 없으면 그룹 3) */
  groupLabels = $derived.by(() => {
    const counts = new Map<string, number>();
    const labels = new Map<number, string>();
    for (const b of this.groups) {
      const name = tags.get(b.tag)?.name ?? "그룹";
      const n = (counts.get(name) ?? 0) + 1;
      counts.set(name, n);
      labels.set(b.id, `${name} ${n}`);
    }
    return labels;
  });

  // ── 불러오기 ────────────────────────────────────────────

  reset() {
    this.#abort?.abort();
    for (const img of this.images.values()) URL.revokeObjectURL(img.url);
    this.images.clear();
    this.sections = [];
    this.activeIndex = 0;
    this.sourceName = null;
    this.source = null;
    this.focusedId = null;
    this.sessionId = null;
    this.pdfInfo = null;
    this.#crops = new Map();
    this.status = "idle";
    this.error = null;
    this.stats = emptyStats();
    this.detected = [];
    this.substituted = {};
    this.#undo = [];
    this.canUndo = false;
  }

  async loadFile(file: File) {
    const buffer = await file.arrayBuffer();
    if (file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf") {
      // pdf.js가 처리하면서 버퍼를 워커로 넘겨버리므로, 뷰어용 사본을 먼저 떠 둔다.
      const bytes = new Uint8Array(buffer.slice(0));
      const fingerprint = { size: bytes.length, sha256: await sha256(bytes) };
      await this.#run(file.name, { kind: "pdf", bytes }, (signal) => {
        this.pdfInfo = fingerprint;
        return this.#processPdf(buffer, signal);
      });
    } else {
      await this.loadText(file.name, decodeText(buffer));
    }
  }

  /** `gdocId`: 구글 문서에서 가져온 경우 — 원본 보기에서 구글 문서 모양(PDF)으로 볼 수 있다 */
  async loadText(name: string, text: string, gdocId?: string) {
    await this.#run(name, { kind: "text", text, gdocId }, (signal) => this.#processText(text, signal));
  }

  cancel() {
    this.#abort?.abort();
  }

  async #run(name: string, source: Source, job: (signal: AbortSignal) => Promise<Carry>) {
    this.reset();
    this.freshLoads++;
    this.sessionId = newSessionId();
    this.sourceName = name;
    this.source = source;
    this.status = "processing";
    const abort = new AbortController();
    this.#abort = abort;
    try {
      const carry = await job(abort.signal);
      if (abort.signal.aborted) {
        // 취소 직전까지 이어 붙이던 문장도 버리지 않는다.
        if (carry.pending && this.sections.length > 0) {
          this.sections[this.sections.length - 1].blocks.push(
            hydrate({ type: "sentence", text: carry.pending, kind: "narration", hasEllipsis: ELLIPSIS_RE.test(carry.pending), warnings: ["noTerminator"], page: carry.pendingPage }),
          );
        }
        this.status = "cancelled";
      } else {
        this.status = "done";
      }
      await this.detectLabels();
    } catch (e) {
      this.status = "error";
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      if (this.#abort === abort) this.#abort = null;
    }
  }

  #addSection(label: string, range: Section["range"], out: ChunkOutput) {
    this.stats.removedPageNumbers += out.stats.removedPageNumbers;
    this.stats.removedHeaders += out.stats.removedHeaders;
    this.stats.pagesWithoutText.push(...out.stats.pagesWithoutText);
    if (out.blocks.length === 0) return;
    const parts = splitBlocks(out.blocks.map(hydrate));
    parts.forEach((blocks, i) => {
      const partLabel = parts.length === 1 ? label : range.unit === "쪽" ? (pageLabel(blocks) ?? `${label} (${i + 1})`) : `${label} (${i + 1})`;
      this.sections.push({ id: nextId(), label: partLabel, range, blocks });
    });
  }

  async #processPdf(buffer: ArrayBuffer, signal: AbortSignal): Promise<Carry> {
    const { doc: pdf, close } = await openPdf(buffer);
    let carry: Carry = { pending: null, pendingPage: null, furniture: [], marginSeen: {} };
    try {
      const total = pdf.numPages;
      this.progress = { done: 0, total, unit: "쪽" };
      let first = 1;
      while (first <= total && !signal.aborted) {
        const size = first === 1 ? PDF_FIRST_CHUNK : PDF_CHUNK;
        const last = Math.min(total, first + size - 1);
        const pages: PdfPageInput[] = [];
        for (let n = first; n <= last; n++) {
          if (signal.aborted) break;
          pages.push(await extractPage(pdf, n, this.images));
          this.progress.done = n;
        }
        if (pages.length === 0) break;
        const isLast = !signal.aborted && last === total;
        const out = await invoke<ChunkOutput>("process_pdf_chunk", {
          input: { pages, carry, isLast, options: $state.snapshot(this.options) },
        });
        carry = out.carry;
        const lastDone = pages[pages.length - 1].pageNumber;
        this.#addSection(first === lastDone ? `${first}쪽` : `${first}–${lastDone}쪽`, { from: first, to: lastDone, unit: "쪽" }, out);
        first = last + 1;
        await nextFrame();
      }
    } finally {
      await close();
    }
    return carry;
  }

  async #processText(text: string, signal: AbortSignal): Promise<Carry> {
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    let carry: Carry = { pending: null, pendingPage: null, furniture: [], marginSeen: {} };
    const chunks = chunkLines(lines);
    this.progress = { done: 0, total: lines.length, unit: "줄" };
    for (let i = 0; i < chunks.length && !signal.aborted; i++) {
      const [start, end] = chunks[i];
      const out = await invoke<ChunkOutput>("process_text_chunk", {
        input: { lines: lines.slice(start, end), carry, isLast: i === chunks.length - 1, options: $state.snapshot(this.options) },
      });
      carry = out.carry;
      this.#addSection(`${start + 1}–${end}줄`, { from: start + 1, to: end, unit: "줄" }, out);
      this.progress.done = end;
      await nextFrame();
    }
    return carry;
  }

  // ── 세이브 ──────────────────────────────────────────────

  /** 지금 작업을 세이브 파일 내용으로 만든다 (원본 PDF·그림 제외, 가볍게). */
  serialize(): SaveFile {
    const crops: SaveFile["crops"] = {};
    const all = new Map(this.#crops);
    for (const [id, img] of this.images) if (img.crop) all.set(id, img.crop);
    for (const [id, c] of all) crops[id] = [c.page, round1(c.x), round1(c.y), round1(c.w), round1(c.h)];
    return {
      format: "trpg-package-session",
      version: 1,
      name: this.sourceName ?? "시나리오",
      savedAt: Date.now(),
      source:
        this.source?.kind === "text"
          ? { kind: "text", text: this.source.text, ...(this.source.gdocId ? { gdocId: this.source.gdocId } : {}) }
          : this.pdfInfo
            ? { kind: "pdf", ...this.pdfInfo }
            : null,
      options: $state.snapshot(this.options),
      stats: $state.snapshot(this.stats),
      rules: this.rules.map(({ label, name, batchim }) => ({ label, name, batchim })),
      activeIndex: this.activeIndex,
      crops,
      sections: this.sections.map((s) => ({ l: s.label, r: [s.range.from, s.range.to, s.range.unit], b: s.blocks.map(packBlock) })),
      tags: tags.custom.filter((t) => this.groups.some((g) => g.tag === t.id)).map(({ id, name, color }) => ({ id, name, color })),
    };
  }

  /** 세이브 내용으로 작업을 되살린다. PDF 작업이면 원본 PDF를 연결해야 그림·원본 보기가 돌아온다. */
  async restore(file: SaveFile, sessionId: string) {
    if (file?.format !== "trpg-package-session" || file.version !== 1 || !Array.isArray(file.sections)) {
      throw new Error("TRPG Pasta 세이브 파일이 아닙니다");
    }
    this.reset();
    this.sessionId = sessionId;
    this.sourceName = file.name;
    tags.adopt(file.tags);
    this.stats = file.stats ?? emptyStats();
    this.options = { ...this.options, ...file.options };
    if (file.rules?.length) this.rules = file.rules.map((r) => ({ ...r, id: nextId() }));
    this.sections = file.sections.map((s) => ({
      id: nextId(),
      label: s.l,
      range: { from: s.r[0], to: s.r[1], unit: s.r[2] },
      blocks: unpackBlocks(s.b),
    }));
    this.activeIndex = Math.min(Math.max(0, file.activeIndex ?? 0), Math.max(0, this.sections.length - 1));
    this.#crops = new Map(Object.entries(file.crops ?? {}).map(([id, [page, x, y, w, h]]) => [id, { page, x, y, w, h }]));
    if (file.source?.kind === "text") this.source = { kind: "text", text: file.source.text, gdocId: file.source.gdocId };
    else if (file.source?.kind === "pdf") this.pdfInfo = { size: file.source.size, sha256: file.source.sha256 };
    this.status = "done";
    await this.detectLabels();
  }

  /**
   * 세이브로 연 PDF 작업에 원본 PDF를 다시 연결한다. 그림을 다시 잘라내고 원본 보기를 켠다.
   * 세이브 때와 다른 파일이면 `force` 없이는 연결하지 않고 "mismatch"를 돌려준다.
   */
  async attachPdf(file: File, force = false): Promise<"ok" | "mismatch"> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const fingerprint = { size: bytes.length, sha256: await sha256(bytes) };
    if (!force && this.pdfInfo && fingerprint.sha256 !== this.pdfInfo.sha256) return "mismatch";
    this.pdfInfo = fingerprint;
    await recropImages(bytes, this.#crops, this.images);
    this.source = { kind: "pdf", bytes };
    return "ok";
  }

  // ── 이름 치환 ───────────────────────────────────────────

  async detectLabels() {
    const texts = this.sections.flatMap((s) => s.blocks.filter((b) => b.type === "sentence").map((b) => b.text));
    this.detected = texts.length ? await invoke<LabelCount[]>("detect_labels", { texts }) : [];
  }

  async refreshSubstitutions() {
    const section = this.active;
    if (!section) {
      this.substituted = {};
      return;
    }
    // 핸드아웃은 집합과 상관없이 복사 페이지에 모아 보이므로 전부 치환해 둔다.
    const sentences = [...section.blocks.filter((b): b is SentenceBlock => b.type === "sentence"), ...this.groups];
    const rules = $state.snapshot(this.rules);
    const texts = await invoke<string[]>("apply_substitutions", { texts: sentences.map((b) => b.text), rules });
    const map: Record<number, string> = {};
    sentences.forEach((b, i) => (map[b.id] = texts[i]));
    this.substituted = map;
  }

  /** 복사 화면에 보여줄(붙여넣을) 최종 문장 */
  finalText(block: SentenceBlock | GroupBlock): string {
    return this.substituted[block.id] ?? block.text;
  }

  addRule(label = "", name = "") {
    this.rules.push({ id: nextId(), label, name, batchim: "auto" });
  }

  removeRule(id: number) {
    this.rules = this.rules.filter((r) => r.id !== id);
  }

  // ── 검증/수정 ───────────────────────────────────────────

  /** 블록이 들어 있는 집합 번호와 위치 */
  find(id: number): { sectionIndex: number; index: number; block: Block } | null {
    for (let sectionIndex = 0; sectionIndex < this.sections.length; sectionIndex++) {
      const index = this.sections[sectionIndex].blocks.findIndex((b) => b.id === id);
      if (index >= 0) return { sectionIndex, index, block: this.sections[sectionIndex].blocks[index] };
    }
    return null;
  }

  #locate(id: number): { section: Section; index: number } | null {
    for (const section of this.sections) {
      const index = section.blocks.findIndex((b) => b.id === id);
      if (index >= 0) return { section, index };
    }
    return null;
  }

  #pushUndo(entry: UndoEntry) {
    this.#undo.push(entry);
    if (this.#undo.length > 100) this.#undo.shift();
    this.canUndo = true;
  }

  #snapshot(section: Section) {
    this.#pushUndo({ kind: "blocks", sectionId: section.id, blocks: $state.snapshot(section.blocks) as Block[] });
  }

  undo(): number | null {
    const entry = this.#undo.pop();
    this.canUndo = this.#undo.length > 0;
    if (!entry) return null;
    if (entry.kind === "split") {
      const index = this.sections.findIndex((s) => s.id === entry.original.id);
      const second = this.sections.findIndex((s) => s.id === entry.newId);
      if (index < 0) return null;
      if (second >= 0) this.sections.splice(second, 1);
      this.sections[index] = entry.original;
      this.activeIndex = index;
      return index;
    }
    if (entry.kind === "add") {
      const index = this.sections.findIndex((s) => s.id === entry.id);
      if (index < 0) return null;
      this.sections.splice(index, 1);
      this.activeIndex = Math.max(0, Math.min(index - 1, this.sections.length - 1));
      return this.activeIndex;
    }
    if (entry.kind === "rename") {
      const index = this.sections.findIndex((s) => s.id === entry.id);
      if (index < 0) return null;
      this.sections[index].label = entry.label;
      return index;
    }
    if (entry.kind === "merge") {
      const index = this.sections.findIndex((s) => s.id === entry.mergedId);
      if (index < 0) return null;
      this.sections.splice(index, 1, entry.first, entry.second);
      this.activeIndex = index;
      return index;
    }
    if (entry.kind === "section") {
      const index = Math.min(entry.index, this.sections.length);
      this.sections.splice(index, 0, entry.section);
      this.activeIndex = index;
      return index;
    }
    const index = this.sections.findIndex((s) => s.id === entry.sectionId);
    if (index < 0) return null;
    this.sections[index].blocks = entry.blocks;
    this.activeIndex = index;
    return index;
  }

  /** index번째 집합과 바로 아래 집합을 하나로 합친다 (되돌리기 가능). 너무 잘게 나뉜 집합을 묶을 때. */
  mergeWithNext(index: number) {
    const first = this.sections[index];
    const second = this.sections[index + 1];
    if (!first || !second) return;
    const range = { from: Math.min(first.range.from, second.range.from), to: Math.max(first.range.to, second.range.to), unit: first.range.unit };
    const merged: Section = {
      id: nextId(),
      label: range.from === range.to ? `${range.from}${range.unit}` : `${range.from}–${range.to}${range.unit}`,
      range,
      blocks: [...first.blocks, ...second.blocks],
    };
    this.#pushUndo({ kind: "merge", mergedId: merged.id, first: $state.snapshot(first) as Section, second: $state.snapshot(second) as Section });
    this.sections.splice(index, 2, merged);
    if (this.activeIndex > index) this.activeIndex--;
  }

  /** 이 줄부터 새 집합으로 나눈다 (되돌리기 가능). 나뉜 쪽 집합으로 이동한다. */
  splitSectionAt(blockId: number) {
    const loc = this.#locate(blockId);
    if (!loc || loc.index === 0) return;
    const { section, index } = loc;
    const sectionIndex = this.sections.indexOf(section);
    const original = $state.snapshot(section) as Section;
    const head = section.blocks.slice(0, index);
    const tail = section.blocks.slice(index);
    let firstLabel = section.label;
    let secondLabel = `${section.label} (2)`;
    if (AUTO_LABEL.test(section.label) && section.range.unit === "쪽") {
      firstLabel = pageLabel(head) ?? firstLabel;
      secondLabel = pageLabel(tail) ?? secondLabel;
    }
    const created: Section = { id: nextId(), label: secondLabel, range: { ...section.range }, blocks: tail };
    section.blocks = head;
    section.label = firstLabel;
    this.sections.splice(sectionIndex + 1, 0, created);
    this.#pushUndo({ kind: "split", original, newId: created.id });
    this.activeIndex = sectionIndex + 1;
  }

  /** 지금 집합 바로 뒤에 빈 집합을 만든다 (되돌리기 가능). 새 집합의 id를 돌려준다. */
  addSection(): number {
    const after = Math.min(this.activeIndex, this.sections.length - 1);
    const base = this.sections[after];
    const created: Section = {
      id: nextId(),
      label: "새 집합",
      range: base ? { ...base.range } : { from: 1, to: 1, unit: "줄" },
      blocks: [hydrate({ type: "sentence", text: "", kind: "narration", hasEllipsis: false, warnings: [], page: null })],
    };
    this.sections.splice(after + 1, 0, created);
    this.#pushUndo({ kind: "add", id: created.id });
    this.activeIndex = after + 1;
    return created.id;
  }

  renameSection(id: number, label: string) {
    const section = this.sections.find((s) => s.id === id);
    const name = label.trim();
    if (!section || !name || name === section.label) return;
    this.#pushUndo({ kind: "rename", id, label: section.label });
    section.label = name;
  }

  /** 집합을 통째로 지운다 (되돌리기 가능). */
  removeSection(id: number) {
    const index = this.sections.findIndex((s) => s.id === id);
    if (index < 0) return;
    const [section] = this.sections.splice(index, 1);
    this.#pushUndo({ kind: "section", section: $state.snapshot(section) as Section, index });
    if (this.activeIndex >= this.sections.length) this.activeIndex = Math.max(0, this.sections.length - 1);
    else if (this.activeIndex > index) this.activeIndex--;
  }

  setText(block: SentenceBlock, text: string) {
    block.text = text;
    block.hasEllipsis = ELLIPSIS_RE.test(text);
    // 사람이 직접 고친 문장의 자동 경고는 지운다.
    if (block.warnings.length) block.warnings = [];
  }

  setKind(block: SentenceBlock, kind: SentenceKind) {
    block.kind = kind;
  }

  /** 커서 위치에서 문장을 둘로 나눈다. 새 블록 id를 돌려준다. */
  split(block: SentenceBlock, at: number): number | null {
    const loc = this.#locate(block.id);
    if (!loc) return null;
    this.#snapshot(loc.section);
    const left = block.text.slice(0, at).trimEnd();
    const right = block.text.slice(at).trimStart();
    this.setText(block, left);
    const created = hydrate({ type: "sentence", text: right, kind: block.kind, hasEllipsis: ELLIPSIS_RE.test(right), warnings: [], page: block.page });
    loc.section.blocks.splice(loc.index + 1, 0, created);
    return created.id;
  }

  /** 앞 문장에 이어 붙인다. 합쳐진 블록 id와 이어 붙인 지점을 돌려준다. */
  mergeWithPrevious(block: SentenceBlock): { id: number; caret: number } | null {
    const loc = this.#locate(block.id);
    if (!loc || loc.index === 0) return null;
    const prev = loc.section.blocks[loc.index - 1];
    if (prev.type !== "sentence") return null;
    this.#snapshot(loc.section);
    const caret = prev.text.length;
    const joiner = prev.text && block.text && !/\s$/.test(prev.text) ? " " : "";
    this.setText(prev, prev.text + joiner + block.text);
    if (block.note) prev.note = prev.note ? `${prev.note}\n${block.note}` : block.note;
    prev.speaker ??= block.speaker;
    loc.section.blocks.splice(loc.index, 1);
    return { id: prev.id, caret: caret + joiner.length };
  }

  remove(block: Block) {
    const loc = this.#locate(block.id);
    if (!loc) return;
    this.#snapshot(loc.section);
    loc.section.blocks.splice(loc.index, 1);
  }

  insertAfter(block: Block): number | null {
    const loc = this.#locate(block.id);
    if (!loc) return null;
    this.#snapshot(loc.section);
    const created = hydrate({ type: "sentence", text: "", kind: "narration", hasEllipsis: false, warnings: [], page: block.page });
    loc.section.blocks.splice(loc.index + 1, 0, created);
    return created.id;
  }

  /**
   * 원본 보기에서 직접 자른 그림을 현재 줄 뒤에 넣는다 (집합 되돌리기로 되돌릴 수 있음).
   * 현재 줄이 지금 집합에 없으면 집합 끝에 넣는다. 새 블록 id를 돌려준다.
   */
  addImage(image: StoredImage & { crop: Crop }): number | null {
    const section = this.active;
    if (!section) return null;
    let n = 1;
    while (this.images.has(`cut-${n}`) || this.#crops.has(`cut-${n}`)) n++;
    const imageId = `cut-${n}`;
    this.images.set(imageId, image);
    this.#snapshot(section);
    const at = this.focusedId === null ? -1 : section.blocks.findIndex((b) => b.id === this.focusedId);
    const created = hydrate({ type: "image", imageId, caption: null, page: image.crop.page });
    section.blocks.splice(at < 0 ? section.blocks.length : at + 1, 0, created);
    return created.id;
  }

  // ── 그룹 ────────────────────────────────────────────────

  /**
   * 고른 줄들을 그룹 카드 하나로 묶는다 (집합 되돌리기로 되돌릴 수 있음). 그림 줄은 묶지 않고 카드 뒤에 남긴다.
   * 만든 그룹의 id를 돌려준다.
   */
  makeGroup(ids: number[], tag?: string): number | null {
    const section = this.active;
    if (!section) return null;
    const wanted = new Set(ids);
    const chosen = section.blocks.filter((b): b is SentenceBlock | GroupBlock => wanted.has(b.id) && b.type !== "image");
    if (!chosen.length) return null;
    this.#snapshot(section);
    const notes = chosen.map((b) => b.note?.trim()).filter(Boolean);
    const merged = chosen.filter((b): b is GroupBlock => b.type === "group");
    const created: GroupBlock = {
      type: "group",
      id: nextId(),
      text: chosen.map((b) => b.text).join("\n"),
      title: merged.find((b) => b.title)?.title,
      tag: tag ?? merged.find((b) => b.tag)?.tag,
      page: chosen.find((b) => b.page != null)?.page ?? null,
      used: false,
      note: notes.length ? notes.join("\n") : undefined,
    };
    const at = section.blocks.indexOf(chosen[0]);
    const gone = new Set<Block>(chosen);
    const rest = section.blocks.filter((b) => !gone.has(b));
    rest.splice(at, 0, created);
    section.blocks = rest;
    return created.id;
  }

  setGroupText(block: GroupBlock, text: string) {
    block.text = text;
  }

  setGroupTitle(block: GroupBlock, title: string) {
    block.title = title.trim() ? title : undefined;
  }

  setGroupTag(block: GroupBlock, tag: string | undefined) {
    block.tag = tag;
  }

  /** 그룹을 at 글자 위치에서 두 카드로 나눈다 (태그는 둘 다 같다). 새 카드의 id를 돌려준다. */
  splitGroup(block: GroupBlock, at: number): number | null {
    const loc = this.#locate(block.id);
    if (!loc) return null;
    const head = block.text.slice(0, at).replace(/\s+$/, "");
    const tail = block.text.slice(at).replace(/^\s+/, "");
    if (!head || !tail) return null;
    this.#snapshot(loc.section);
    block.text = head;
    const created: GroupBlock = { type: "group", id: nextId(), text: tail, tag: block.tag, page: block.page, used: false };
    loc.section.blocks.splice(loc.index + 1, 0, created);
    return created.id;
  }

  /** 그룹을 다시 보통 줄로 푼다 (한 줄 = 카드 하나). 첫 줄의 id를 돌려준다. */
  unwrapGroup(block: GroupBlock): number | null {
    const loc = this.#locate(block.id);
    if (!loc) return null;
    this.#snapshot(loc.section);
    const lines = block.text.split("\n").map((t) => t.trim()).filter(Boolean);
    const created = (lines.length ? lines : [""]).map((text) => makeSentence(nextId(), text, block.page));
    created[0].note = block.note;
    loc.section.blocks.splice(loc.index, 1, ...created);
    return created[0].id;
  }

  setNote(block: Block, note: string | undefined) {
    block.note = note;
  }

  setSpeaker(block: Block, speaker: string | undefined) {
    const name = speaker?.trim();
    block.speaker = name || undefined;
  }

  /** 화자 추천: 이미 쓴 화자(많이 쓴 순) + 이름 치환 규칙의 캐릭터 이름 */
  speakerSuggestions = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const s of this.sections) for (const b of s.blocks) if (b.speaker) counts.set(b.speaker, (counts.get(b.speaker) ?? 0) + 1);
    const used = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
    const names = this.rules.map((r) => r.name.trim()).filter(Boolean);
    return [...new Set([...used, ...names])];
  });

  resetUsed() {
    for (const s of this.sections) for (const b of s.blocks) b.used = false;
  }
}

export const scenario = new ScenarioState();

export function matchesFilter(block: Block, filter: Filter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "image":
      return block.type === "image";
    case "group":
      return block.type === "group";
    case "dialogue":
      return block.type === "sentence" && block.kind === "dialogue";
    case "gm":
      return isSecret(block);
    case "warning":
      return block.type === "sentence" && block.warnings.length > 0;
    case "note":
      return !!block.note;
  }
}
