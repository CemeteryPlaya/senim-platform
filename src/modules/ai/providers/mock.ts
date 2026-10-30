import sharp from "sharp";
import type { AiProvider } from "../provider";
import { parseRequestText } from "./mock-text";

/**
 * Мок-провайдер — основной режим, пока владелец не выбрал ИИ-провайдера. Без сети и детерминированный:
 * текст разбирается по словарю, «иллюстрация» — фото помещения со схемой гарнитура поверх.
 */

const MAX_WIDTH = 1024;

const PALETTE: readonly [RegExp, string][] = [
  [/шалфе|зел[её]н|олив/iu, "#8a9a86"],
  [/бел|молочн|светл/iu, "#ecebe6"],
  [/графит|ч[её]рн|сер|т[её]мн/iu, "#4a4d50"],
  [/дуб|орех|дерев|венге/iu, "#a47b55"],
  [/голуб|син/iu, "#7d97b0"],
  [/бежев|песочн/iu, "#cdb89a"],
];
const DEFAULT_COLOR = "#8a9a86";

function colorFor(prompt: string): string {
  return PALETTE.find(([pattern]) => pattern.test(prompt))?.[1] ?? DEFAULT_COLOR;
}

/** Схема кухонного гарнитура: нижние и верхние шкафы и столешница вдоль нижней части кадра. */
function cabinetsSvg(width: number, height: number, color: string): string {
  const base = { y: height * 0.62, h: height * 0.3 };
  const top = { y: height * 0.18, h: height * 0.22 };
  const doors = 6;
  const doorW = (width * 0.86) / doors;
  const x0 = width * 0.07;
  const row = (y: number, h: number) =>
    Array.from({ length: doors }, (_, i) => {
      const x = x0 + i * doorW;
      return `<rect x="${x + 2}" y="${y}" width="${doorW - 4}" height="${h}" rx="4" fill="${color}" fill-opacity="0.88" stroke="#ffffff" stroke-opacity="0.5" stroke-width="2"/>`;
    }).join("");
  const counter = `<rect x="${x0 - 6}" y="${base.y - height * 0.03}" width="${width * 0.86 + 12}" height="${height * 0.03}" fill="#f4f1ea" fill-opacity="0.95"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${row(top.y, top.h)}${counter}${row(base.y, base.h)}</svg>`;
}

export const mockProvider: AiProvider = {
  name: "mock",

  async structureRequest({ text, furnitureTypes }) {
    const raw = parseRequestText(
      text,
      furnitureTypes.map((t) => t.slug),
    );
    return {
      raw,
      usage: {
        model: "mock/text",
        inputTokens: Math.ceil(text.length / 4),
        outputTokens: Math.ceil(JSON.stringify(raw).length / 4),
      },
    };
  },

  async visualizeRoom({ image, prompt }) {
    const { data, info } = await sharp(image)
      .rotate()
      .resize({ width: MAX_WIDTH, withoutEnlargement: true })
      .modulate({ brightness: 1.04, saturation: 0.85 })
      .toBuffer({ resolveWithObject: true });
    const overlay = Buffer.from(cabinetsSvg(info.width, info.height, colorFor(prompt)));
    const png = await sharp(data).composite([{ input: overlay }]).png().toBuffer();
    return { images: [{ data: new Uint8Array(png), contentType: "image/png" }], usage: { model: "mock/image", images: 1 } };
  },
};
