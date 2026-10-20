// pdf.js로 PDF를 열고, 쪽마다 줄·그림을 추출해 Rust(process_pdf_chunk)로 넘길 형태로 만든다.
// 그림은 쪽을 렌더링한 뒤 해당 영역을 잘라 blob URL로 보관한다.

import "./stream-polyfill";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { extractLines, findFigures, type Rect } from "./pdf-layout";
import type { Crop, PdfPageInput, StoredImage } from "./types";

export type { PDFDocumentProxy };

export interface OpenedPdf {
  doc: PDFDocumentProxy;
  /** 문서와 전용 워커를 함께 닫는다. */
  close: () => Promise<void>;
}

/**
 * 문서마다 전용 워커를 붙여 연다.
 * (전역 워커를 같이 쓰면 한 문서를 닫을 때 워커가 함께 파괴되어, 처리 중 문서와 원본 뷰어가 서로를 망가뜨린다.)
 */
export async function openPdf(data: ArrayBuffer): Promise<OpenedPdf> {
  const port = new Worker(new URL("./pdf.worker.ts", import.meta.url), { type: "module" });
  // pdf.js 타입 정의는 port를 null로만 적어 두었지만, 실제 생성자는 Worker를 받는다.
  const worker = new pdfjs.PDFWorker({ port: port as unknown as null });
  const shutdown = () => {
    worker.destroy();
    port.terminate();
  };
  try {
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(data),
      worker,
      cMapUrl: "/pdfjs/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/pdfjs/standard_fonts/",
      wasmUrl: "/pdfjs/wasm/",
      iccUrl: "/pdfjs/iccs/",
    }).promise;
    return {
      doc,
      close: async () => {
        await doc.destroy();
        shutdown();
      },
    };
  } catch (e) {
    shutdown();
    throw e;
  }
}

const RENDER_SCALE = 2;
const MAX_CANVAS_SIDE = 4096;

async function renderAndCrop(page: PDFPageProxy, rects: Rect[]): Promise<(StoredImage | null)[]> {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(RENDER_SCALE, MAX_CANVAS_SIDE / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return rects.map(() => null);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;

  const images: (StoredImage | null)[] = [];
  for (const r of rects) {
    const crop = document.createElement("canvas");
    crop.width = Math.max(1, Math.round(r.w * scale));
    crop.height = Math.max(1, Math.round(r.h * scale));
    crop.getContext("2d")?.drawImage(canvas, r.x * scale, r.y * scale, r.w * scale, r.h * scale, 0, 0, crop.width, crop.height);
    const blob = await new Promise<Blob | null>((resolve) => crop.toBlob(resolve, "image/png"));
    images.push(blob && { url: URL.createObjectURL(blob), width: crop.width, height: crop.height, page: page.pageNumber });
  }
  canvas.width = canvas.height = 0;
  return images;
}

let imageSeq = 0;

/** 한 쪽을 Rust로 넘길 형태로 추출한다. 잘라낸 그림은 `store`에 넣는다. */
export async function extractPage(pdf: PDFDocumentProxy, pageNumber: number, store: Map<string, StoredImage>): Promise<PdfPageInput> {
  const page = await pdf.getPage(pageNumber);
  try {
    const viewport = page.getViewport({ scale: 1 });
    const allLines = await extractLines(page, viewport);
    const figures = await findFigures(page, viewport, allLines);
    let rects = figures.rects;
    // 그림 안의 라벨은 그림에 이미 보이므로 문장으로 넣지 않는다.
    const lines = allLines.filter((l) => !figures.covered.has(l));
    // 글자 없이 그림만 있는 쪽(스캔본 등)은 쪽 전체를 그림으로 보여준다.
    if (allLines.length === 0 && rects.length > 0) rects = [{ x: 0, y: 0, w: viewport.width, h: viewport.height }];

    const images: PdfPageInput["images"] = [];
    if (rects.length > 0) {
      const crops = await renderAndCrop(page, rects);
      crops.forEach((img, i) => {
        if (!img) return;
        const id = `img-${++imageSeq}`;
        store.set(id, { ...img, crop: { page: pageNumber, ...rects[i] } });
        images.push({ id, y: rects[i].y });
      });
    }
    return { pageNumber, width: viewport.width, height: viewport.height, lines, images };
  } finally {
    page.cleanup();
  }
}

/** 원본 보기에서 직접 고른 영역(배율 1 좌표)을 그림으로 잘라낸다. */
export async function cropRegion(pdf: PDFDocumentProxy, pageNumber: number, rect: Rect): Promise<(StoredImage & { crop: Crop }) | null> {
  const page = await pdf.getPage(pageNumber);
  try {
    const [img] = await renderAndCrop(page, [rect]);
    return img && { ...img, crop: { page: pageNumber, ...rect } };
  } finally {
    page.cleanup();
  }
}

/**
 * 세이브에서 되살릴 때: 기록해 둔 위치(crop)로 원본 PDF에서 그림을 다시 잘라낸다.
 * 세이브 파일에 그림을 넣지 않아도 되므로 세이브가 가볍다.
 */
export async function recropImages(bytes: Uint8Array, crops: Map<string, Crop>, store: Map<string, StoredImage>) {
  const byPage = new Map<number, [string, Crop][]>();
  for (const entry of crops) {
    const list = byPage.get(entry[1].page) ?? [];
    list.push(entry);
    byPage.set(entry[1].page, list);
  }
  const { doc, close } = await openPdf(bytes.slice().buffer);
  try {
    for (const [pageNumber, items] of byPage) {
      if (pageNumber < 1 || pageNumber > doc.numPages) continue;
      const page = await doc.getPage(pageNumber);
      const images = await renderAndCrop(
        page,
        items.map(([, c]) => ({ x: c.x, y: c.y, w: c.w, h: c.h })),
      );
      images.forEach((img, i) => img && store.set(items[i][0], { ...img, crop: items[i][1] }));
      page.cleanup();
    }
  } finally {
    await close();
  }
}

/** 원본 PDF가 세이브 때와 같은 파일인지 확인하는 지문 */
export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
