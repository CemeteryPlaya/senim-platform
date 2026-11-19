import { describe, expect, it, vi } from "vitest";

vi.mock("./registry", () => ({
  fileUrl: vi.fn(async (f: { storageKey: string }, opts: { fileName?: string } = {}) => {
    if (f.storageKey.endsWith("/broken")) throw new Error("storage down");
    return `url:${f.storageKey}${opts.fileName ? `:${opts.fileName}` : ""}`;
  }),
}));
vi.mock("@/platform/logger", () => ({ logger: { warn: vi.fn() } }));

const { fileViews } = await import("./views");
const { logger } = await import("@/platform/logger");

const file = (id: string, contentType: string) => ({ id, provider: "local", storageKey: `request_design/${id}`, contentType });

describe("вид файлов для экрана", () => {
  it("фото — image без имени файла, PDF — pdf с именем по номеру; номера с 1 по порядку", async () => {
    const views = await fileViews([file("a", "image/jpeg"), file("b", "application/pdf"), file("c", "image/heic")], (n) => `design-${n}.pdf`);
    expect(views).toEqual([
      { id: "a", kind: "image", src: "url:request_design/a", n: 1 },
      { id: "b", kind: "pdf", src: "url:request_design/b:design-2.pdf", n: 2 },
      { id: "c", kind: "image", src: "url:request_design/c", n: 3 },
    ]);
  });

  it("сбой ссылки одного файла не роняет экран: файл пропускается с предупреждением, номера — по исходному порядку", async () => {
    const views = await fileViews([file("a", "application/pdf"), file("broken", "image/jpeg"), file("c", "application/pdf")], (n) => `design-${n}.pdf`);
    expect(views).toEqual([
      { id: "a", kind: "pdf", src: "url:request_design/a:design-1.pdf", n: 1 },
      { id: "c", kind: "pdf", src: "url:request_design/c:design-3.pdf", n: 3 },
    ]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith("file view url failed", expect.objectContaining({ fileId: "broken" }));
  });

  it("нет файлов — пустой список", async () => {
    expect(await fileViews([], (n) => `design-${n}.pdf`)).toEqual([]);
  });
});
