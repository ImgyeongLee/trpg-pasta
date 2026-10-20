# 구조 (Architecture)

지금 코드가 어떻게 생겼는지 요약한다. 계획(plan)을 쓸 때 기준으로 삼고, 구조가 바뀌면 이 문서도 고친다.

## 기술 스택

| 층              | 사용                                                        |
| --------------- | ----------------------------------------------------------- |
| 데스크탑 껍데기 | Tauri 2 (플러그인: clipboard-manager, dialog, opener)       |
| 백엔드          | Rust (regex, flate2, reqwest + rustls, serde)               |
| 프론트엔드      | Svelte 5 (runes) + SvelteKit (adapter-static, SPA) + Vite 8 |
| 편집기          | CodeMirror 6 (`@codemirror/state`·`view`·`commands`)        |
| PDF             | pdfjs-dist 5.7.284 legacy 빌드, 문서마다 전용 워커          |
| 아이콘·글꼴     | `@lucide/svelte`, Pretendard 가변 글꼴 (dynamic subset)     |

## 폴더 지도

```
src-tauri/src/
  lib.rs              Tauri 명령 등록
  scenario/           글 → 문장 블록 (segment: 문장 나누기, layout: PDF 줄 → 문단·쪽수·머리글, plain: 텍스트, filters, vocab)
  josa.rs             이름 치환 + 조사 교정, 라벨 찾기
  session.rs          세이브 (gzip, sessions/ 폴더, 세이브 파일 내보내기·열기)
  export.rs           텍스트·그림 내보내기 (경로는 Rust 대화상자로)
  gdocs.rs            구글 문서 공개 링크 → 텍스트 / PDF
  store.rs            작은 JSON 저장 (macros.json)

src/
  routes/+page.svelte 앱 껍데기: 왼쪽 메뉴, 편집 페이지 ↔ 복사 페이지, ⌘S, 닫기 경고
  app.css             색·글꼴 토큰 (라이트/다크)
  lib/icons.ts        Lucide 아이콘 묶음
  lib/layout.svelte.ts 화면 배치 설정 (localStorage)
  lib/ui/             자체 컨트롤: Select, Switch, ConfirmButton, Splitter, PinButton, DialogHost(dialog.svelte.ts)
  lib/scenario/
    state.svelte.ts   시나리오 상태의 중심 (ScenarioState): 불러오기·집합·그룹·치환·세이브 직렬화·되돌리기
    types.ts          블록·세이브 형식 타입
    tags.svelte.ts    그룹 태그 (프리셋 + 만든 태그)
    session.svelte.ts 세이브 목록·저장·열기, 저장 안 됨 표시
    export.svelte.ts  텍스트 만들기, 그림 파일 이름
    pdf.ts, pdf.worker.ts, pdf-layout.ts, stream-polyfill.ts   PDF 읽기·그림 잘라내기
    gdocs.ts          구글 문서 가져오기
    ScenarioPrep.svelte  편집 페이지 (윗줄, 줄 찾기 칩, 집합 목록, 이름 치환 패널, 원본 보기)
    editor/           CodeMirror 편집기 (SectionEditor, lines, decorations, LineBar, GroupCard, api)
    viewer/           원본 보기 (PdfViewer, GdocViewer, TextViewer, match, sync)
    TagPicker, CopyRow, NoteEditor, SpeakerTag, ImageView, SectionList, RulesPanel, ExportMenu, ImportPanel
  lib/play/           복사 페이지 (CopyPage, ScenarioCopyPanel, GroupList)
  lib/macros/         채팅 매크로 (state, template, MacroBoard, MacroList, MacroCard)
```

## 데이터 모델

```ts
Section { id, label, range: { from, to, unit: "쪽" | "줄" }, blocks: Block[] }

Block =
  | SentenceBlock { type: "sentence", text, kind: "narration" | "dialogue" | "heading", hasEllipsis, warnings, page }
  | ImageBlock    { type: "image", imageId, caption, page }
  | GroupBlock    { type: "group", text /* 여러 줄 */, title?, tag?, page }
// 모든 블록 공통: id, used(복사함), note?(GM 메모), speaker?(화자)

GroupTag { id, name, color /* #rrggbb */, preset?, secret? /* GM 정보: 복사·내보내기 제외 */ }
```

- **블록 하나 = 복사 카드 하나.** 문장은 한 줄, 그룹은 여러 줄을 한 번에 복사한다.
- 블록 id는 실행 중에만 쓰는 숫자다. 세이브에는 id를 넣지 않는다.
- `ScenarioState`의 파생 값: `groups`(전체 그룹), `groupLabels`(「핸드아웃 2」 같은 이름), `imageNumbers`, `total`, `substituted`(현재 집합 + 모든 그룹의 치환 결과).

## 편집기 모델 (CodeMirror)

- 집합 하나 = 편집기 하나. **문서의 한 줄 = 블록 하나.** `lines.ts`의 `lineIds` StateField가 줄마다 블록 id를 들고, 변경이 생기면 줄 시작 위치를 따라 옮긴다 (줄을 합치면 아래 블록이 위에 흡수되고 메모가 옮겨진다).
- 그림·그룹 줄은 문서에서 자리표시 글자 하나(`IMAGE_CHAR` U+FFFC, `GROUP_CHAR` U+E000)이고, `decorations.ts`가 그 줄을 Svelte 컴포넌트(ImageView, GroupCard)를 띄운 블록 위젯으로 바꾼다. `protectImages`가 그 줄에 글자가 섞이거나 이웃 줄과 합쳐지는 것을 막는다.
- 줄 정보(종류·메모·화자·경고)는 편집기 밖(Svelte 상태)에 있고, `lineMeta` facet으로 읽어 `refreshMeta` 효과로 다시 그린다.
- 편집기 밖에서 블록이 바뀌면(집합 나누기·그룹 묶기·되돌리기·세이브 열기) 서명을 비교해 편집기 상태를 다시 만든다.
- 편집기 밖에서 편집기를 움직일 때는 `editor/api.svelte.ts`의 `editor.handle`(focus, jumpNext, deleteLines, selectAll)과 `focus.ts`의 `focusBlock`을 쓴다.

## PDF 추출

- `pdf.ts`의 `extractPage`가 쪽마다 `pdf-layout.ts`의 `extractLines`(글자 조각 → 줄)와 `findFigures`를 부르고, 그림 영역을 렌더링해 잘라낸 뒤(`renderAndCrop`) 줄·그림 위치를 Rust로 넘긴다.
- `findFigures`는 연산자 목록을 한 번 훑는다.
  - 그림 연산자(`paintImageXObject`·인라인·반복·`paintImageMaskXObject`)의 영역 (24pt 미만, 글자 있는 쪽의 배경 그림은 뺌)
  - 칠한 경로(`constructPath`의 minMax 상자)를 서로 닿는 것끼리 묶어, 경로 8개 이상이고 안의 글자 수 ≤ 경로 수 × 2인 무리를 벡터 그림으로 본다 (배치도는 그림, 표·글상자는 글).
  - 그림 영역 안에 가운데가 들어가는 줄은 `covered`로 돌려주어 문장에서 뺀다.
- 원본 보기의 「그림 자르기」는 `cropRegion` → `scenario.addImage`(현재 줄 뒤, 집합 되돌리기 기록). 이 그림의 id는 `cut-n`이고 자동 추출 그림(`img-n`)과 같은 방식으로 `crops`에 기록된다.

## 저장 위치

| 무엇                 | 어디                                                       | 형식                                 |
| -------------------- | ---------------------------------------------------------- | ------------------------------------ |
| 작업 세이브          | 앱 데이터 폴더 `sessions/<id>.trpgsave` + `<id>.meta.json` | gzip JSON / JSON                     |
| 세이브 파일 내보내기 | 사용자가 고른 곳 `*.trpgsave`                              | gzip JSON (열 때는 일반 JSON도 받음) |
| 채팅 매크로          | 앱 데이터 폴더 `macros.json`                               | JSON                                 |
| 화면 배치            | localStorage `trpg.layout`                                 | JSON                                 |
| 정리 옵션            | localStorage `trpg.scenario.options`                       | JSON                                 |
| 이름 치환 규칙       | localStorage `trpg.scenario.rules` (세이브에도 들어감)     | JSON                                 |
| 만든 태그            | localStorage `trpg.groupTags` (쓴 것은 세이브에도 들어감)  | JSON                                 |

### 세이브 형식 (`SaveFile`, version 1)

`format`, `version`, `name`, `savedAt`, `source`(텍스트 원문 / PDF 지문 SHA-256·크기), `options`, `stats`, `rules`, `activeIndex`, `crops`(그림 id → [쪽, x, y, w, h]), `sections`, `tags`(만든 태그).
블록은 짧은 키로 줄인다: `t` 종류(`s` 문장 / `i` 그림 / `g` 그룹), `x` 글, `k` 종류(`d` 대사 / `h` 제목), `w` 경고, `p` 쪽, `u` 복사함, `n` 메모, `s` 화자, `ti` 그룹 제목, `tg` 그룹 태그, `im` 그림 id, `c` 그림 설명.

**호환 규칙** (`unpackBlocks`): 예전 `t: "h"`(핸드아웃) → `핸드아웃` 태그 그룹, 예전 `k: "g"`(GM 정보 줄) → 이어진 줄끼리 `GM 정보` 태그 그룹. 형식을 바꾸면 여기에 규칙을 더한다.

## Tauri 명령 (IPC)

| 명령                                                                                                  | 하는 일                                                             |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `process_pdf_chunk`, `process_text_chunk`                                                             | 글 조각 → 문장·그림 블록 (조각 사이 이어지는 문장은 `Carry`로 넘김) |
| `apply_substitutions`, `detect_labels`                                                                | 이름 치환·조사 교정, 글 속 라벨(탐사자·PC1 …) 찾기                  |
| `load_data`, `save_data`                                                                              | 작은 JSON 저장 (매크로)                                             |
| `save_text_file`, `save_image_file`, `choose_export_folder`, `write_export_file`                      | 내보내기 (대화상자로 고른 경로에만)                                 |
| `save_session`, `list_sessions`, `load_session`, `delete_session`, `export_session`, `decode_session` | 세이브 (본문은 raw 바이너리 IPC)                                    |
| `fetch_google_doc`, `fetch_google_doc_pdf`                                                            | 구글 문서 공개 링크 → 텍스트 / PDF 바이트                           |

권한은 `src-tauri/capabilities/default.json` (클립보드 쓰기, 창 항상 위, 창 닫기, `https://docs.google.com/*` 열기).

## 개발 환경 주의

- Node **22.12 이상** (Vite 8). `.nvmrc` 참고.
- 개발 서버는 **127.0.0.1:1440** (HMR 1441). 다른 프로젝트가 1420을 쓰고 있어서 옮겼다.
- macOS 14 WKWebView에는 ReadableStream 비동기 반복이 없어 pdf.js 앞에 `stream-polyfill.ts`를 넣는다 (메인 스레드 + 워커).
- pdf.js는 `vite.config.js`의 `optimizeDeps.include`에 넣어 둔다. 빠지면 첫 PDF를 놓을 때 Vite가 다시 읽으며 화면이 초기화된다.
- 화면 자동 확인은 Playwright 1.59.1 + WebKit으로 `http://127.0.0.1:1440`을 띄우고 `window.__TAURI_INTERNALS__.invoke`를 흉내 내서 한다 (1.62는 멈춤).
