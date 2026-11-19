import { describe, expect, it } from "vitest";
import { designView } from "./design-files";

const texts = { pdf: (n: number) => `pdf ${n}`, photo: (n: number) => `photo ${n}`, hidden: "скрыт" };

describe("дизайн-проект на экране", () => {
  it("фото — в галерею, PDF — строкой-ссылкой; подписи по номеру файла", () => {
    const view = designView(
      [
        { id: "a", kind: "image", src: "/a", n: 1 },
        { id: "b", kind: "pdf", src: "/b.pdf", n: 2 },
      ],
      texts,
    );
    expect(view).toEqual({
      gallery: [{ src: "/a", alt: "photo 1" }],
      rows: [{ id: "b", href: "/b.pdf", label: "pdf 2", hidden: null }],
    });
  });

  it("скрытый файл (только покупателю) — строкой с пометкой, не в галерее", () => {
    const view = designView(
      [
        { id: "a", kind: "image", src: "/a", n: 1, hidden: true },
        { id: "b", kind: "pdf", src: "/b.pdf", n: 2, hidden: true },
        { id: "c", kind: "image", src: "/c", n: 3, hidden: false },
      ],
      texts,
    );
    expect(view).toEqual({
      gallery: [{ src: "/c", alt: "photo 3" }],
      rows: [
        { id: "a", href: "/a", label: "photo 1", hidden: "скрыт" },
        { id: "b", href: "/b.pdf", label: "pdf 2", hidden: "скрыт" },
      ],
    });
  });

  it("нет файлов — раздела нет", () => {
    expect(designView([], texts)).toBeNull();
  });
});
