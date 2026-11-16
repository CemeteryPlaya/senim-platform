import { SkeletonCard, SkeletonChips, SkeletonScreen, SkeletonTitle } from "@/kit";

/**
 * Каркас каталога работ (аудит поведения B-3): заголовок с пояснением, фильтры (на телефоне — ряд чипов, на компьютере —
 * колонка слева, как у `Sidebar`) и карточки работ с фото (на компьютере — три колонки).
 */
export default function CatalogLoading() {
  return (
    <SkeletonScreen>
      <SkeletonTitle lead />
      <div className="flex flex-col gap-stack-section desktop:grid desktop:grid-cols-sidebar desktop:items-start desktop:gap-split">
        <div className="desktop:hidden">
          <SkeletonChips count={3} />
        </div>
        <div className="hidden desktop:block">
          <SkeletonCard lines={6} headline={false} />
        </div>
        <div className="grid gap-stack-group desktop:grid-cols-3">
          <SkeletonCard photo lines={2} />
          <SkeletonCard photo lines={2} />
          <SkeletonCard photo lines={2} />
        </div>
      </div>
    </SkeletonScreen>
  );
}
