import { cn } from "./cn";

export type PhotoRatio = "4/3" | "1/1" | "16/9";

const RATIOS: Record<PhotoRatio, string> = {
  "4/3": "aspect-4/3",
  "1/1": "aspect-square",
  "16/9": "aspect-video",
};

/** Место под фото. Пока снимка нет — ровная заглушка цвета `line`, без рисунка и иконки. */
export function PhotoSlot({ src, alt, ratio }: { src?: string; alt: string; ratio: PhotoRatio }) {
  return (
    <div className={cn("w-full overflow-hidden rounded-field bg-line", RATIOS[ratio])}>
      {src && (
        // Адрес из хранилища файлов, оптимизатор изображений не нужен.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} loading="lazy" decoding="async" className="size-full object-cover" />
      )}
    </div>
  );
}
