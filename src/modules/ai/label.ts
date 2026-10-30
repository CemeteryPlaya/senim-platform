import sharp from "sharp";
import { ru } from "@/i18n/ru";

/**
 * Пометка «Иллюстрация ИИ» вшивается в пиксели: картинку, скачанную или пересланную,
 * нельзя выдать за фото реальной работы. Белый текст на сплошной тёмно-зелёной плашке
 * (контраст > 7:1), а не поверх фото.
 */
export const LABEL_RGB = [31, 93, 74];
const LABEL_HEX = "#1f5d4a";

export async function stampAiLabel(image: Uint8Array): Promise<Uint8Array> {
  // Сначала поворот по EXIF, потом размеры: иначе у повёрнутого фото ширина и высота поменяются местами.
  const base = sharp(await sharp(image).rotate().toBuffer());
  const { width = 1024, height = 768 } = await base.metadata();
  const fontSize = Math.max(14, Math.round(Math.min(width, height) * 0.045));
  const barH = Math.round(fontSize * 1.9);
  const barW = Math.min(width, Math.round(fontSize * 9.5));
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${barW}" height="${barH}">` +
    `<rect width="${barW}" height="${barH}" fill="${LABEL_HEX}"/>` +
    `<text x="${Math.round(fontSize * 0.6)}" y="${Math.round(barH * 0.68)}" font-family="sans-serif" font-size="${fontSize}" fill="#ffffff">${ru.ai.label}</text>` +
    `</svg>`;
  const png = await base
    .composite([{ input: Buffer.from(svg), left: 0, top: height - barH }])
    .png()
    .toBuffer();
  return new Uint8Array(png);
}
