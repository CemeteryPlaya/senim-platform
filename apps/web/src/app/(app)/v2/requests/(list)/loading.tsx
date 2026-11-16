import { SkeletonCard, SkeletonChips, SkeletonRows, SkeletonScreen, SkeletonTitle } from "@/kit";

/** Каркас «Моих заявок» (аудит поведения B-3): заголовок, карточка «Нужна ещё мебель?», фильтры и список заявок. */
export default function RequestsLoading() {
  return (
    <SkeletonScreen className="desktop:mx-auto desktop:w-full desktop:max-w-home">
      <SkeletonTitle />
      <SkeletonCard lines={1} />
      <SkeletonChips count={3} />
      <SkeletonRows rows={4} />
    </SkeletonScreen>
  );
}
