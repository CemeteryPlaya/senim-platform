/**
 * Значки приложения для установки на телефон: щит с галочкой, как в шапке и src/app/icon.svg.
 * Цвет — токен --color-primary из src/ui/tokens.css. Запуск: node scripts/generate-icons.mjs
 * (результат лежит в git; перезапускать при смене знака или цвета).
 *
 * public/icons/icon-192.png, icon-512.png — обычные (purpose: any), скруглённый квадрат;
 * public/icons/icon-maskable-512.png — на всю площадь, знак в безопасной зоне (круг 80%):
 *   Android сам обрезает его кругом или «капелькой»;
 * src/app/apple-icon.png — 180×180 для iPhone (Next сам ставит <link rel="apple-touch-icon">);
 *   квадрат без прозрачности — углы iOS скругляет сама.
 */
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tokens = await readFile(path.join(root, "src/ui/tokens.css"), "utf8");
const primary = tokens.match(/--color-primary:\s*(#[0-9a-f]{6})\s*;/i)?.[1];
const onPrimary = tokens.match(/--color-on-primary:\s*(#[0-9a-f]{6})\s*;/i)?.[1];
if (!primary || !onPrimary) throw new Error("В tokens.css нет --color-primary или --color-on-primary");

/** Знак в сетке 32×32 (как icon.svg); scale — доля размера, которую занимает знак относительно icon.svg. */
function svg({ rounded, scale }) {
  const offset = 16 * (1 - scale);
  const background = rounded ? `<rect width="32" height="32" rx="7" fill="${primary}"/>` : `<rect width="32" height="32" fill="${primary}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${background}<g transform="translate(${offset} ${offset}) scale(${scale})" fill="none" stroke="${onPrimary}" stroke-width="2.2" stroke-linejoin="round"><path d="M16 6.5 8.5 9.3v6.2c0 4.7 3.2 8.4 7.5 10 4.3-1.6 7.5-5.3 7.5-10V9.3Z"/><path d="m12.4 15.8 2.6 2.6 4.6-4.9" stroke-linecap="round"/></g></svg>`;
}

const outputs = [
  { file: "public/icons/icon-192.png", size: 192, rounded: true, scale: 1 },
  { file: "public/icons/icon-512.png", size: 512, rounded: true, scale: 1 },
  // Знак icon.svg вписан в круг радиусом 38% — уменьшаем, чтобы с запасом лечь в безопасные 40%.
  { file: "public/icons/icon-maskable-512.png", size: 512, rounded: false, scale: 0.8 },
  { file: "src/app/apple-icon.png", size: 180, rounded: false, scale: 0.9 },
];

await mkdir(path.join(root, "public/icons"), { recursive: true });
for (const { file, size, rounded, scale } of outputs) {
  const image = sharp(Buffer.from(svg({ rounded, scale })), { density: (72 * size) / 32 }).resize(size, size);
  // Квадратные значки без прозрачности: iOS заливает прозрачное чёрным.
  await (rounded ? image : image.flatten({ background: primary }).removeAlpha())
    .png({ compressionLevel: 9 })
    .toFile(path.join(root, file));
  process.stdout.write(`${file} ${size}×${size}\n`);
}
