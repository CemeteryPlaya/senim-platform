import { crc32, deflateSync } from "node:zlib";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { isAppError } from "@/platform/errors";
import { dHash, hammingHex, processImage, sniffType } from "./image";

const svg = (body: string, w = 320, h = 240) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#f4efe6"/>${body}</svg>`);

/** «Кухня»: тёмные фасады слева, светлая столешница, окно справа. */
const KITCHEN = svg(
  `<rect x="10" y="120" width="180" height="110" fill="#3b2f2a"/><rect x="10" y="110" width="200" height="12" fill="#d9c7a8"/>` +
    `<rect x="230" y="30" width="70" height="90" fill="#9ec5d8"/><circle cx="120" cy="60" r="25" fill="#6b5b4f"/>`,
);
/** «Шкаф»: другая композиция. */
const WARDROBE = svg(
  `<rect x="40" y="10" width="90" height="220" fill="#ffffff" stroke="#222" stroke-width="4"/>` +
    `<rect x="140" y="10" width="140" height="220" fill="#222"/><rect x="200" y="100" width="10" height="40" fill="#e0b040"/>`,
);

async function jpeg(input: Buffer, opts: { quality?: number; width?: number } = {}) {
  let img = sharp(input);
  if (opts.width) img = img.resize({ width: opts.width });
  return new Uint8Array(await img.jpeg({ quality: opts.quality ?? 90 }).toBuffer());
}

describe("тип файла по сигнатуре байтов", () => {
  it("узнаёт JPEG, PNG, WEBP, PDF и HEIC независимо от заявленного типа", async () => {
    expect(sniffType(await jpeg(KITCHEN))).toBe("jpeg");
    expect(sniffType(new Uint8Array(await sharp(KITCHEN).png().toBuffer()))).toBe("png");
    expect(sniffType(new Uint8Array(await sharp(KITCHEN).webp().toBuffer()))).toBe("webp");
    expect(sniffType(new TextEncoder().encode("%PDF-1.7\n%âãÏÓ\n"))).toBe("pdf");
    const heic = new Uint8Array([0, 0, 0, 0x18, ...new TextEncoder().encode("ftypheic"), 0, 0, 0, 0]);
    expect(sniffType(heic)).toBe("heic");
  });

  it("текст, SVG и HTML под видом картинки не проходят", () => {
    expect(sniffType(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>"))).toBeNull();
    expect(sniffType(new TextEncoder().encode("<html><script>alert(1)</script>"))).toBeNull();
    expect(sniffType(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });
});

describe("обработка фото", () => {
  it("удаляет EXIF с геолокацией и применяет ориентацию к пикселям", async () => {
    const source = await sharp(svg("", 400, 200))
      .jpeg()
      .withMetadata({ orientation: 6 })
      .withExifMerge({ IFD0: { Make: "Phone" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 10/1 0/1" } })
      .toBuffer();
    const before = await sharp(source).metadata();
    expect(before.exif).toBeDefined();
    expect(before.orientation).toBe(6);

    const out = await processImage(new Uint8Array(source));
    const after = await sharp(Buffer.from(out.bytes)).metadata();
    expect(after.exif).toBeUndefined();
    expect(after.orientation).toBeUndefined();
    expect(Buffer.from(out.bytes).includes(Buffer.from("Phone"))).toBe(false);
    // 400×200 с поворотом на 90° — портрет 200×400.
    expect([out.width, out.height]).toEqual([200, 400]);
    expect(after.format).toBe("jpeg");
    expect(out.contentType).toBe("image/jpeg");
  });

  it("уменьшает большие фото по длинной стороне до 2560 px и не увеличивает маленькие", async () => {
    const big = await processImage(new Uint8Array(await sharp(svg("", 5000, 2500)).png().toBuffer()));
    expect([big.width, big.height]).toEqual([2560, 1280]);
    const small = await processImage(await jpeg(KITCHEN));
    expect([small.width, small.height]).toEqual([320, 240]);
  });

  it("HEIC, который сервер не может раскодировать, — понятная ошибка для пользователя", async () => {
    const fake = new Uint8Array([0, 0, 0, 0x18, ...new TextEncoder().encode("ftypheic"), ...new Uint8Array(64)]);
    const error = await processImage(fake).catch((e: unknown) => e);
    expect(isAppError(error) && error.code).toBe("VALIDATION");
  });

  it("картинка-бомба: маленький файл на 64 млн пикселей отклоняется, не раскодируясь", async () => {
    const bomb = blackPng(8000, 8000);
    expect(bomb.length).toBeLessThan(100_000);
    const error = await processImage(bomb).catch((e: unknown) => e);
    expect(isAppError(error) && error.code).toBe("VALIDATION");
    const hashError = await dHash(bomb).catch((e: unknown) => e);
    expect(hashError).toBeInstanceOf(Error);
  });
});

/** Настоящий PNG (1 бит, оттенки серого, всё чёрное): сжимается в килобайты при любом размере. */
function blackPng(width: number, height: number): Uint8Array {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 1; // глубина 1 бит
  ihdr[9] = 0; // оттенки серого
  const row = Math.ceil(width / 8) + 1; // байт фильтра + пиксели
  const idat = deflateSync(Buffer.alloc(row * height), { level: 9 });
  return new Uint8Array(
    Buffer.concat([Buffer.from("\x89PNG\r\n\x1a\n", "latin1"), chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]),
  );
}

describe("перцептивный хэш (dHash, 64 бита)", () => {
  it("16 шестнадцатеричных символов", async () => {
    expect(await dHash(await jpeg(KITCHEN))).toMatch(/^[0-9a-f]{16}$/);
  });

  it("устойчив к пережатию и уменьшению", async () => {
    const original = await dHash(await jpeg(KITCHEN));
    const recompressed = await dHash(await jpeg(KITCHEN, { quality: 25, width: 160 }));
    expect(hammingHex(original, recompressed)).toBeLessThanOrEqual(4);
  });

  it("различает разные изображения", async () => {
    expect(hammingHex(await dHash(await jpeg(KITCHEN)), await dHash(await jpeg(WARDROBE)))).toBeGreaterThan(16);
  });

  it("расстояние Хэмминга считает различающиеся биты", () => {
    expect(hammingHex("0000000000000000", "0000000000000000")).toBe(0);
    expect(hammingHex("0000000000000000", "000000000000000f")).toBe(4);
    expect(hammingHex("ffffffffffffffff", "0000000000000000")).toBe(64);
  });
});
