import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { isAppError } from "./errors";
import { errorResponse, readTextLimited, routeId } from "./http";

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

describe("routeId", () => {
  it("возвращает id из параметров маршрута", async () => {
    await expect(routeId(Promise.resolve({ id: "doc_1" }))).resolves.toBe("doc_1");
  });

  it("пустой, слишком длинный или отсутствующий id — NOT_FOUND с переданным текстом", async () => {
    for (const params of [{ id: "" }, { id: "x".repeat(65) }, {}]) {
      const err = await routeId(Promise.resolve(params), "нет такого").catch((e: unknown) => e);
      expect(isAppError(err) && err.code === "NOT_FOUND" && err.message === "нет такого").toBe(true);
    }
  });

  it("без текста — короткое «не найдено»; ответ маршрута — 404", async () => {
    const err = await routeId(Promise.resolve({ id: "" })).catch((e: unknown) => e);
    const res = errorResponse(err, "test");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ code: "NOT_FOUND", error: ru.common.errors.notFoundShort });
  });

  it("id длиной 64 допустим", async () => {
    await expect(routeId(Promise.resolve({ id: "x".repeat(64) }))).resolves.toHaveLength(64);
  });
});
