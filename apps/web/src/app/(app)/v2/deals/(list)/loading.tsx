import { SkeletonCard, SkeletonChips, SkeletonScreen, SkeletonTitle } from "@/kit";

/** Каркас «Сделок» (аудит поведения B-3): заголовок, «Идут / Завершены» и карточки сделок; колонка 760 px на компьютере. */
export default function DealsLoading() {
  return (
    <SkeletonScreen className="desktop:mx-auto desktop:w-full desktop:max-w-home">
      <SkeletonTitle />
      <SkeletonChips count={2} />
      <SkeletonCard lines={3} />
      <SkeletonCard lines={3} />
    </SkeletonScreen>
  );
}
