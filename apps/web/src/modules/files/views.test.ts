import { describe, expect, it, vi } from "vitest";

vi.mock("./registry", () => ({
  fileUrl: vi.fn(async (f: { storageKey: string }, opts: { fileName?: string } = {}) => `url:${f.storageKey}${opts.fileName ? `:${opts.fileName}` : ""}`),
}));

const { fileViews } = await import("./views");

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

  it("нет файлов — пустой список", async () => {
    expect(await fileViews([], (n) => `design-${n}.pdf`)).toEqual([]);
  });
});
