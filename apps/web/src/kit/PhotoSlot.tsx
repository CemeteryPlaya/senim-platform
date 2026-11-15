import type { ReactNode } from "react";
import { cn } from "./cn";
import { PhotoImage } from "./PhotoImage";

export type PhotoRatio = "4/3" | "1/1" | "16/9";

const RATIOS: Record<PhotoRatio, string> = {
  "4/3": "aspect-4/3",
  "1/1": "aspect-square",
  "16/9": "aspect-video",
};

/** `thumb` — радиус 12 px (фото на карточке с отступом 8 px: 20 − 8); `none` — фото во всю ширину карточки, радиус карточки обрезает сам родитель. */
export type PhotoRadius = "thumb" | "none";

const RADII: Record<PhotoRadius, string> = { thumb: "rounded-thumb", none: "" };

export type PhotoSlotProps = {
  src?: string;
  alt: string;
  ratio: PhotoRatio;
  /** Ширина фото на экране для выбора размера файла; по умолчанию — в сетке: треть на компьютере, вся ширина на телефоне. */
  sizes?: string;
  radius?: PhotoRadius;
  priority?: boolean;
  /** Размеры в раскладке: например, заполнить ячейку сетки на компьютере (`desktop:aspect-auto desktop:h-full`). */
  className?: string;
  /** Слой поверх фото: затемнение и капсула `glass-clear` (цена, счётчик). Только при заданном `src` и только после загрузки фото (`photo-overlay`). */
  children?: ReactNode;
};

/** Ширина колонки каталога: на компьютере треть содержимого (1100 px), на телефоне — экран. */
const DEFAULT_SIZES = "(min-width: 64rem) 360px, 100vw";

/**
 * Место под фото. Заливка `photo-fallback` и внутренний контур (`photo-frame`), картинка — `next/image` с проявлением
 * 200 мс. Пока снимка нет — ровная заливка, без рисунка и иконки. Серверный компонент (картинку рисует клиентский
 * `PhotoImage`).
 */
export function PhotoSlot({ src, alt, ratio, sizes = DEFAULT_SIZES, radius = "thumb", priority, className, children }: PhotoSlotProps) {
  return (
    <div className={cn("photo-frame w-full", RADII[radius], RATIOS[ratio], className)}>
      {src && <PhotoImage src={src} alt={alt} sizes={sizes} priority={priority} />}
      {src && children && <div className="photo-overlay pointer-events-none absolute inset-0">{children}</div>}
    </div>
  );
}
