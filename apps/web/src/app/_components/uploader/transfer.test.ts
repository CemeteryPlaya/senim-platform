import { describe, expect, it } from "vitest";
import { contentTypeOf, isHeic, PHOTO_ACCEPT } from "./transfer";

const file = (name: string, type = "") => new File([new Uint8Array(1)], name, { type });

describe("contentTypeOf: тип для подписи цели загрузки", () => {
  it("тип, указанный браузером, главнее расширения", () => {
    expect(contentTypeOf(file("photo.heic", "image/png"))).toBe("image/png");
  });

  it("без типа: HEIC/HEIF и JPEG — по расширению в любом регистре", () => {
    expect(contentTypeOf(file("IMG_1.HEIC"))).toBe("image/heic");
    expect(contentTypeOf(file("img.heif"))).toBe("image/heif");
    expect(contentTypeOf(file("a.JPG"))).toBe("image/jpeg");
    expect(contentTypeOf(file("a.b.jpeg"))).toBe("image/jpeg");
  });

  it("«двоичные данные» вместо типа (Android, Windows без кодека HEIF) — тоже по расширению", () => {
    expect(contentTypeOf(file("IMG_2.HEIC", "application/octet-stream"))).toBe("image/heic");
  });

  it("без типа и с другим расширением или без него — двоичные данные", () => {
    expect(contentTypeOf(file("scan.png"))).toBe("application/octet-stream");
    expect(contentTypeOf(file("noext"))).toBe("application/octet-stream");
  });
});

describe("HEIC в поле загрузки", () => {
  it("выбор файлов пропускает HEIC/HEIF и по типу, и по расширению", () => {
    expect(PHOTO_ACCEPT.split(",")).toEqual(expect.arrayContaining(["image/*", "image/heic", "image/heif", ".heic", ".heif"]));
  });

  it("isHeic — по заявленному типу или расширению", () => {
    expect(isHeic(file("IMG_1.HEIC"))).toBe(true);
    expect(isHeic(file("x", "image/heif"))).toBe(true);
    expect(isHeic(file("x.jpg", "image/jpeg"))).toBe(false);
  });
});
