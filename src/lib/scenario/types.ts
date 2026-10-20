// Rust(src-tauri/src/scenario)와 주고받는 타입. serde camelCase에 맞춘다.

/** GM 정보는 줄 종류가 아니라 그룹 태그(GM 정보)로 정한다. */
export type SentenceKind = "narration" | "dialogue" | "heading";
export type Warning = "unbalancedQuote" | "noTerminator" | "tooLong";
export type BatchimMode = "auto" | "yes" | "no" | "rieul";

export interface RawSentenceBlock {
  type: "sentence";
  text: string;
  kind: SentenceKind;
  hasEllipsis: boolean;
  warnings: Warning[];
  page: number | null;
}

export interface RawImageBlock {
  type: "image";
  imageId: string | null;
  caption: string | null;
  page: number | null;
}

export type RawBlock = RawSentenceBlock | RawImageBlock;

/** 그룹: 여러 줄을 묶은 카드 하나. 줄바꿈이 있어도 한 번에 복사된다. (사람이 편집기에서 만든다) */
export interface GroupBlock extends BlockState {
  type: "group";
  text: string;
  /** 카드 제목 (복사되지 않음) */
  title?: string;
  /** 태그 id (핸드아웃·성공 판정·실패 판정 또는 사람이 만든 태그) */
  tag?: string;
  page: number | null;
}

interface BlockState {
  id: number;
  /** 복사 화면에서 이미 붙여넣었는지 */
  used: boolean;
  /** GM용 메모 — 화면에만 보이고 복사되지 않는다 */
  note?: string;
  /** 대사의 화자 (GM용 메모 — 복사되지 않는다) */
  speaker?: string;
}

export type SentenceBlock = RawSentenceBlock & BlockState;
export type ImageBlock = RawImageBlock & BlockState;
export type Block = SentenceBlock | ImageBlock | GroupBlock;

export interface ProcessOptions {
  splitOnEllipsis: boolean;
  joinLinesWithoutSpace: boolean;
  removePageNumbers: boolean;
  removeHeaders: boolean;
}

export interface Carry {
  pending: string | null;
  pendingPage: number | null;
  furniture: string[];
  marginSeen: Record<string, number>;
}

export interface Stats {
  removedPageNumbers: number;
  removedHeaders: number;
  pagesWithoutText: number[];
}

export interface ChunkOutput {
  blocks: RawBlock[];
  carry: Carry;
  stats: Stats;
}

export interface PdfLine {
  text: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
}

export interface PdfPageInput {
  pageNumber: number;
  width: number;
  height: number;
  lines: PdfLine[];
  images: { id: string; y: number }[];
}

export interface Section {
  id: number;
  /** "1–3쪽" / "1–150줄" */
  label: string;
  /** 원본에서의 범위 (PDF는 쪽, 텍스트는 줄 — 1부터) */
  range: { from: number; to: number; unit: "쪽" | "줄" };
  blocks: Block[];
}

export interface SubstitutionRule {
  id: number;
  label: string;
  name: string;
  batchim: BatchimMode;
}

export interface LabelCount {
  label: string;
  count: number;
}

/** PDF 쪽에서 그림을 잘라낸 위치 (배율 1 좌표). 세이브에는 그림 대신 이것만 넣는다. */
export interface Crop {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StoredImage {
  url: string;
  width: number;
  height: number;
  page: number;
  crop?: Crop;
}

/**
 * 세이브 파일 (gzip으로 압축한 JSON, 확장자 .trpgsave).
 * 가볍게 하려고 원본 PDF·그림은 넣지 않고, 블록은 짧은 키에 기본값은 생략한다.
 */
export interface SaveFile {
  format: "trpg-package-session";
  version: 1;
  name: string;
  savedAt: number;
  /** text: 원문 전체 / pdf: 원본을 다시 연결할 때 확인할 지문 */
  source: { kind: "pdf"; size: number; sha256: string } | { kind: "text"; text: string; gdocId?: string } | null;
  options: ProcessOptions;
  stats: Stats;
  rules: { label: string; name: string; batchim: BatchimMode }[];
  activeIndex: number;
  /** 그림 id → [쪽, x, y, 너비, 높이] */
  crops: Record<string, [number, number, number, number, number]>;
  sections: SavedSection[];
  /** 그룹에 쓰인 사람이 만든 태그 (프리셋 제외) */
  tags?: { id: string; name: string; color: string }[];
}

export interface SavedSection {
  /** label */
  l: string;
  /** range: [from, to, unit] */
  r: [number, number, "쪽" | "줄"];
  /** blocks */
  b: SavedBlock[];
}

/** 블록 (기본값은 생략): t 종류(s 문장/i 그림/g 그룹, 예전 h는 핸드아웃 태그 그룹), x 문장, ti 그룹 제목, tg 그룹 태그, k 대사(d)·제목(h) (예전 세이브의 g는 GM 정보 — 열 때 GM 정보 그룹으로 바뀜), w 경고, p 쪽, u 복사함, n 메모, s 화자, im 그림 id, c 그림 설명 */
export interface SavedBlock {
  t: "s" | "i" | "g" | "h";
  x?: string;
  ti?: string;
  tg?: string;
  k?: "d" | "h" | "g";
  w?: Warning[];
  p?: number;
  u?: 1;
  n?: string;
  s?: string;
  im?: string;
  c?: string;
}

/** 최근 작업 목록에 보일 요약 */
export interface SessionMeta {
  id: string;
  name: string;
  updatedAt: number;
  total: number;
  sections: number;
  sourceKind: "pdf" | "text" | null;
  size?: number;
}
