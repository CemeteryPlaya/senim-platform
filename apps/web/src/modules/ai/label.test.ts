import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { LABEL_RGB, stampAiLabel } from "./label";

async function pixel(bytes: Uint8Array, x: number, y: number) {
  const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i], data[i + 1], data[i + 2]];
}

describe("stampAiLabel — пометка «Иллюстрация ИИ» в самой картинке", () => {
  it("ставит плашку в левом нижнем углу, размер картинки не меняется", async () => {
    const source = await sharp({ create: { width: 900, height: 600, channels: 3, background: "#ffffff" } }).png().toBuffer();
    const stamped = await stampAiLabel(new Uint8Array(source));

    const meta = await sharp(stamped).metadata();
    expect([meta.width, meta.height]).toEqual([900, 600]);
    expect(await pixel(stamped, 4, 596)).toEqual(LABEL_RGB);
    expect(await pixel(stamped, 890, 10)).toEqual([255, 255, 255]);
  });

  it("плашка читаема и на маленькой картинке", async () => {
    const source = await sharp({ create: { width: 200, height: 150, channels: 3, background: "#000000" } }).jpeg().toBuffer();
    const stamped = await stampAiLabel(new Uint8Array(source));
    expect(await pixel(stamped, 2, 148)).toEqual(LABEL_RGB);
  });
});
