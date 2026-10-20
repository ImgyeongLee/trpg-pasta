// pdf.js 페이지에서 줄과 그림 영역을 뽑는 순수 로직 (DOM 불필요 — Node 테스트 하네스에서도 쓴다).

import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PdfLine } from "./types";

type Matrix = number[];

interface TextPiece {
  str: string;
  x: number;
  baseline: number;
  width: number;
  size: number;
}

/** 같은 기준선에 놓인 글자 조각을 한 줄로 묶는다. */
function groupLines(pieces: TextPiece[]): PdfLine[] {
  pieces.sort((a, b) => a.baseline - b.baseline || a.x - b.x);
  const rows: TextPiece[][] = [];
  for (const piece of pieces) {
    const row = rows[rows.length - 1];
    const ref = row?.[0];
    if (ref && Math.abs(piece.baseline - ref.baseline) < Math.min(piece.size, ref.size) * 0.5) {
      row.push(piece);
    } else {
      rows.push([piece]);
    }
  }

  return rows.map((row) => {
    row.sort((a, b) => a.x - b.x);
    let text = "";
    let right = row[0].x;
    for (const p of row) {
      const gap = p.x - right;
      if (text && gap > p.size * 0.15 && !/\s$/.test(text) && !/^\s/.test(p.str)) text += " ";
      text += p.str;
      // 공백 조각은 너비가 엉터리인 경우가 있어(수백 pt) 줄 너비에 넣지 않는다.
      if (p.str.trim()) right = Math.max(right, p.x + p.width);
    }
    const size = Math.max(...row.map((p) => p.size));
    const left = row[0].x;
    const baseline = Math.min(...row.map((p) => p.baseline));
    return {
      text: text.replace(/\s+/g, " ").trim(),
      x: left,
      y: baseline - size,
      width: right - left,
      fontSize: size,
    };
  }).filter((l) => l.text.length > 0);
}

export async function extractLines(page: PDFPageProxy, viewport: pdfjs.PageViewport): Promise<PdfLine[]> {
  const content = await page.getTextContent();
  const pieces: TextPiece[] = [];
  for (const item of content.items) {
    if (!("str" in item) || !item.str) continue;
    const tx = pdfjs.Util.transform(viewport.transform, item.transform);
    const size = Math.hypot(tx[2], tx[3]);
    // 세로쓰기·회전된 글자는 건너뛴다.
    if (size < 1 || Math.abs(tx[1]) > Math.abs(tx[0]) * 0.5) continue;
    pieces.push({ str: item.str, x: tx[4], baseline: tx[5], width: item.width * viewport.scale, size });
  }
  return groupLines(pieces);
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PageFigures {
  /** 그림으로 잘라낼 영역 (뷰포트 좌표, 위에서 아래 순) */
  rects: Rect[];
  /** 그림이 덮어 문장에서 빼야 할 줄 */
  covered: Set<PdfLine>;
}

/** 벡터 그림으로 볼 최소 경로 수. 회색 글상자(사각형 하나)·밑줄 몇 개는 그림이 아니다. */
const FIGURE_MIN_PATHS = 8;

/**
 * 연산자 목록을 한 번 훑어 그림 영역(뷰포트 좌표)을 구한다.
 * - 사진 같은 그림: 그림·마스크 그림 연산자가 그리는 영역
 * - 선·상자로 그린 그림(배치도·지도): 칠한 경로가 모인 영역 중 경로가 많고 안의 글자가 적고 짧은 것.
 *   글이 빽빽한 표나 글상자는 그림으로 보지 않는다.
 */
export async function findFigures(page: PDFPageProxy, viewport: pdfjs.PageViewport, lines: PdfLine[]): Promise<PageFigures> {
  const { OPS, Util } = pdfjs;
  const ops = await page.getOperatorList();
  const imageOps = new Set<number>([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageXObjectRepeat, OPS.paintImageMaskXObject]);
  // constructPath의 첫 인자가 칠하기·선 긋기일 때만 보이는 경로다 (endPath는 잘라내기용).
  const paintOps = new Set<number>([
    OPS.stroke,
    OPS.closeStroke,
    OPS.fill,
    OPS.eoFill,
    OPS.fillStroke,
    OPS.eoFillStroke,
    OPS.closeFillStroke,
    OPS.closeEOFillStroke,
  ]);
  const pageArea = viewport.width * viewport.height;
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  const images: Rect[] = [];
  const paths: Rect[] = [];

  /** 사용자 좌표의 상자를 뷰포트 좌표의 상자로 */
  const box = (x0: number, y0: number, x1: number, y1: number): Rect => {
    const m = Util.transform(viewport.transform, ctm);
    const xs = [m[0] * x0 + m[2] * y0, m[0] * x1 + m[2] * y0, m[0] * x0 + m[2] * y1, m[0] * x1 + m[2] * y1].map((v) => v + m[4]);
    const ys = [m[1] * x0 + m[3] * y0, m[1] * x1 + m[3] * y0, m[1] * x0 + m[3] * y1, m[1] * x1 + m[3] * y1].map((v) => v + m[5]);
    const x = Math.max(0, Math.min(...xs));
    const y = Math.max(0, Math.min(...ys));
    return { x, y, w: Math.min(viewport.width, Math.max(...xs)) - x, h: Math.min(viewport.height, Math.max(...ys)) - y };
  };

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = Util.transform(ctm, args);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      if (Array.isArray(args?.[0]) && args[0].length === 6) ctm = Util.transform(ctm, args[0]);
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
    else if (imageOps.has(fn)) images.push(box(0, 0, 1, 1));
    else if (fn === OPS.constructPath && paintOps.has(args?.[0]) && args[2]?.length === 4) {
      // pdf.js 5: [칠하기 연산, [경로], minMax(사용자 좌표의 [minX, minY, maxX, maxY])]
      const r = box(args[2][0], args[2][1], args[2][2], args[2][3]);
      // 쪽 전체를 덮는 배경 사각형은 뺀다.
      if (r.w * r.h <= pageArea * 0.85) paths.push(r);
    }
  }

  const hasText = lines.length > 0;
  const rects = images.filter(
    // 장식용 작은 그림과, 글자가 있는 쪽의 배경 그림은 뺀다.
    (r) => r.w >= 24 && r.h >= 24 && !(hasText && r.w * r.h > pageArea * 0.85),
  );

  for (const cluster of clusterRects(paths, 4)) {
    if (cluster.count < FIGURE_MIN_PATHS || cluster.w < 24 || cluster.h < 24) continue;
    const inside = lines.filter((l) => within(l, cluster));
    const chars = inside.reduce((sum, l) => sum + l.text.length, 0);
    // 배치도의 라벨은 짧고 드물다 (경로 하나에 두 글자 이하). 표는 경로보다 글자가 훨씬 많다.
    if (chars > cluster.count * 2) continue;
    // 경로 상자에는 선 굵기가 빠져 있어 가장자리 선이 잘리지 않게 조금 넓힌다.
    const x = Math.max(0, cluster.x - 3);
    const y = Math.max(0, cluster.y - 3);
    rects.push({ x, y, w: Math.min(viewport.width, cluster.x + cluster.w + 3) - x, h: Math.min(viewport.height, cluster.y + cluster.h + 3) - y });
  }

  const merged = mergeRects(rects).sort((a, b) => a.y - b.y);
  const covered = new Set<PdfLine>(hasText ? lines.filter((l) => merged.some((r) => within(l, r))) : []);
  return { rects: merged, covered };
}

/** 줄의 가운데가 영역 안에 있는가 */
function within(line: PdfLine, r: Rect): boolean {
  const cx = line.x + line.width / 2;
  const cy = line.y + line.fontSize / 2;
  return cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h;
}

/**
 * 겹치거나 `pad`만큼 가까운 경로 상자를 무리로 묶는다.
 * 경로가 수천 개인 쪽도 있어, 새 상자를 기존 무리에 붙여 가며 무리끼리만 다시 합친다.
 */
function clusterRects(rects: Rect[], pad: number): (Rect & { count: number })[] {
  let groups = rects.map((r) => ({ ...r, count: 1 }));
  let changed = true;
  while (changed) {
    changed = false;
    const next: (Rect & { count: number })[] = [];
    for (const r of groups) {
      const hit = next.find((g) => touches(g, r, pad));
      if (!hit) {
        next.push({ ...r });
        continue;
      }
      const x = Math.min(hit.x, r.x);
      const y = Math.min(hit.y, r.y);
      hit.w = Math.max(hit.x + hit.w, r.x + r.w) - x;
      hit.h = Math.max(hit.y + hit.h, r.y + r.h) - y;
      hit.x = x;
      hit.y = y;
      hit.count += r.count;
      changed = true;
    }
    groups = next;
  }
  return groups;
}

function touches(a: Rect, b: Rect, pad: number): boolean {
  return a.x - pad <= b.x + b.w && b.x - pad <= a.x + a.w && a.y - pad <= b.y + b.h && b.y - pad <= a.y + a.h;
}

/** 겹치거나 맞닿은 그림 조각(타일로 나뉜 이미지 등)을 하나로 합친다. */
function mergeRects(rects: Rect[]): Rect[] {
  const out = rects.map((r) => ({ ...r }));
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i];
        const b = out[j];
        if (touches(a, b, 2)) {
          const x = Math.min(a.x, b.x);
          const y = Math.min(a.y, b.y);
          out[i] = { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
          out.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  return out;
}
