// 편집기(CodeMirror)가 직접 그리는 부분에 쓰는 Lucide 아이콘 (SVG 문자열). 이모지는 쓰지 않는다.

const svg = (size: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const triangleAlert = (size = 12) =>
  svg(size, '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>');

export const userRound = (size = 11) => svg(size, '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>');

export const stickyNote = (size = 12) =>
  svg(
    size,
    '<path d="M21 9a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2z"/><path d="M15 3v5a1 1 0 0 0 1 1h5"/>',
  );
