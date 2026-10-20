// textarea 높이를 내용에 맞춘다. 글이 바뀔 때뿐 아니라 폭이 바뀔 때(패널을 열고 닫을 때)도 다시 맞춘다.
export function autosize(node: HTMLTextAreaElement, _value?: string) {
  let lastWidth = 0;
  const fit = () => {
    node.style.height = "auto";
    node.style.height = `${node.scrollHeight}px`;
  };
  const observer = new ResizeObserver(([entry]) => {
    const width = entry.contentRect.width;
    if (width !== lastWidth) {
      lastWidth = width;
      fit();
    }
  });
  observer.observe(node);
  fit();
  return {
    update: fit,
    destroy: () => observer.disconnect(),
  };
}
