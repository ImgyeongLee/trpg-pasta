# TRPG Pasta — 작업 안내

TRPG GM용 데스크탑 앱 (Tauri 2 + Rust + Svelte 5 + Vite 8). 이 저장소는 **스펙 주도 개발(SDD)**로 만든다.

## 반드시 지킬 것

1. 작업 전에 [specs/constitution.md](specs/constitution.md)를 따른다. 헌법은 기능 스펙보다 우선한다.
2. 흐름은 [specs/README.md](specs/README.md): **명세 → 사용자 확인 → 계획 → 작업 → 구현 → 검증 → 스펙 갱신.**
   - 새 기능: `specs/NNN-이름/`에 [templates](specs/templates/)로 `spec.md`를 먼저 쓰고, 열린 질문을 사용자에게 묻고, 확인을 받은 뒤 `plan.md`·`tasks.md`를 쓰고 구현한다.
   - 기존 기능 변경: 그 기능의 `spec.md`를 먼저 고친다 (없앤 요구사항은 「결정 기록」에 남김).
   - 요구사항이 바뀌지 않는 작은 수정(글자·색·명백한 버그)은 바로 고쳐도 된다.
3. 구현이 끝나면 `spec.md` 상태·결정 기록, [specs/architecture.md](specs/architecture.md), README 기능 설명을 맞춘다.
4. 사용자가 이미 정한 것(스펙의 결정 기록)을 다시 뒤집지 않는다. 바꿔야 하면 먼저 묻는다.

## 자주 쓰는 명령

```bash
export PATH=~/.nvm/versions/node/v22.23.1/bin:$PATH   # Node 22.12 이상 필요 (Vite 8)
npm install
npm run tauri dev        # 앱 실행 (개발 서버 http://127.0.0.1:1440)
npm run check            # 타입 검사 — 오류·경고 0이어야 함
cd src-tauri && cargo test && cargo clippy   # Rust를 건드렸을 때
```

## 알아 둘 것

- 구조·데이터 모델·세이브 형식·저장 위치·Tauri 명령: [specs/architecture.md](specs/architecture.md)
- 개발 서버 포트는 **1440** (1420은 다른 프로젝트가 씀).
- 화면 확인은 실제로 띄워서 한다. 자동으로 볼 때는 Playwright 1.59.1 + WebKit (1.62는 멈춤), `window.__TAURI_INTERNALS__.invoke`를 흉내 낸다.
- 세이브 형식을 바꾸면 예전 세이브를 여는 변환 규칙(`state.svelte.ts`의 `unpackBlocks`)을 함께 만든다.
- 커밋·푸시는 사용자가 요청할 때만.
