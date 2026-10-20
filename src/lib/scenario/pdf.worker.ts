// pdf.js 워커에도 같은 폴리필을 먼저 적용한 뒤 원래 워커를 불러온다.
import "./stream-polyfill";
import "pdfjs-dist/legacy/build/pdf.worker.min.mjs";
