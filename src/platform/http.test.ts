import { describe, expect, it } from "vitest";
import { readTextLimited } from "./http";

const URL_ = "http://localhost/api/webhooks/bank";

/** Поток из кусков по 1 КБ; считает, сколько кусков у него забрали. */
function chunkedStream(chunks: number) {
  let pulled = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled === chunks) return controller.close();
      pulled++;
      controller.enqueue(new Uint8Array(1024).fill(97));
    },
  });
  return { stream, pulled: () => pulled };
}

describe("readTextLimited", () => {
  it("читает тело в пределах лимита", async () => {
    expect(await readTextLimited(new Request(URL_, { method: "POST", body: '{"a":"тест"}' }), 1024)).toBe('{"a":"тест"}');
  });

  it("лимит — в байтах, а не в символах", async () => {
    expect(await readTextLimited(new Request(URL_, { method: "POST", body: "ё".repeat(600) }), 1024)).toBeNull();
  });

  it("отказывает по content-length, не читая тело", async () => {
    const { stream, pulled } = chunkedStream(100);
    const request = new Request(URL_, { method: "POST", body: stream, headers: { "content-length": String(100 * 1024) }, duplex: "half" } as RequestInit);
    expect(await readTextLimited(request, 4096)).toBeNull();
    expect(pulled()).toBeLessThanOrEqual(1);
  });

  it("без content-length обрывает чтение на лимите", async () => {
    const { stream, pulled } = chunkedStream(1000);
    const request = new Request(URL_, { method: "POST", body: stream, duplex: "half" } as RequestInit);
    expect(await readTextLimited(request, 4096)).toBeNull();
    expect(pulled()).toBeLessThan(10);
  });

  it("пустое тело — пустая строка", async () => {
    expect(await readTextLimited(new Request(URL_, { method: "POST" }), 1024)).toBe("");
  });
});
