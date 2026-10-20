// macOS 14의 WKWebView(Safari 17)는 ReadableStream의 비동기 반복(for await ... of stream)을 지원하지 않는다.
// pdf.js의 getTextContent()와 워커의 압축 해제가 이 기능을 쓰므로, 없으면 직접 채워 넣는다.

type Iterable = ReadableStream & { values?: unknown; [Symbol.asyncIterator]?: unknown };

const proto = ReadableStream.prototype as Iterable;

if (typeof proto[Symbol.asyncIterator] !== "function") {
  const values = function (this: ReadableStream, { preventCancel = false } = {}) {
    const reader = this.getReader();
    return {
      async next() {
        try {
          const result = await reader.read();
          if (result.done) reader.releaseLock();
          return result;
        } catch (e) {
          reader.releaseLock();
          throw e;
        }
      },
      async return(value?: unknown) {
        if (preventCancel) {
          reader.releaseLock();
        } else {
          const cancelled = reader.cancel(value);
          reader.releaseLock();
          await cancelled;
        }
        return { done: true, value };
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  };
  Object.defineProperty(proto, "values", { value: values, writable: true, configurable: true });
  Object.defineProperty(proto, Symbol.asyncIterator, { value: values, writable: true, configurable: true });
}

export {};
