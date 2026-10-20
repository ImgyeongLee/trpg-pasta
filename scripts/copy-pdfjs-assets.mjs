// pdf.js가 한글 CID 폰트, 표준 폰트, JPX 이미지를 해석할 때 필요한 자산을 static/으로 복사한다.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "pdfjs-dist");
const dest = join(root, "static", "pdfjs");

mkdirSync(dest, { recursive: true });
for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  if (existsSync(join(src, dir))) {
    cpSync(join(src, dir), join(dest, dir), { recursive: true });
  }
}
console.log("pdf.js assets copied to static/pdfjs");
