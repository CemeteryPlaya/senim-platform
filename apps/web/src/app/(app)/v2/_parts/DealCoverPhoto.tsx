import { PhotoSlot } from "@/kit";
import type { DealCover } from "./deal-cover";

export type DealCoverPhotoProps = {
  cover: DealCover;
  /** Шаг сделки на фото («Шаг 2 из 5: Изготовление»); `null` — без капсулы (сделка остановлена). */
  caption: string | null;
  /** Ширина фото на экране для выбора размера файла. */
  sizes: string;
  /** Скругление снаружи карточки (`rounded-card`); в обложке `Card` радиус обрезает сама карточка. */
  className?: string;
};

/**
 * Шаг сделки капсулой `glass-clear photo-capsule` у нижнего края фото поверх затемнения `scrim-photo` (в нижней четверти
 * затемнение полное: белый текст держит контраст на самом светлом кадре). Радиус капсулы — 14 px в px (`rounded-status`,
 * как у чипа статуса): при переносе (шрифт 200 %) — скруглённый прямоугольник, а не «облако». Слой поверх обложки — и здесь,
 * и у обложки карточки сделки, которая открывается на весь экран (`PhotoGallery`).
 */
export function DealCoverCaption({ caption }: { caption: string }) {
  return (
    <>
      <div aria-hidden className="scrim-photo" />
      <div className="absolute inset-x-3 bottom-3 flex">
        <p className="glass-clear photo-capsule inline-flex min-h-8 max-w-full items-center rounded-status px-chip-x py-chip-y text-sub">{caption}</p>
      </div>
    </>
  );
}

/**
 * Обложка сделки — последнее фото отчёта хода работ (Ruling 6: только фото отчёта), 16 : 9, с шагом сделки капсулой
 * (`DealCoverCaption`). Карточка-герой главной.
 */
export function DealCoverPhoto({ cover, caption, sizes, className }: DealCoverPhotoProps) {
  return (
    <PhotoSlot src={cover.src} alt={cover.alt} ratio="16/9" radius="none" sizes={sizes} priority {...(className ? { className } : {})}>
      {caption && <DealCoverCaption caption={caption} />}
    </PhotoSlot>
  );
}
