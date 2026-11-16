import { SkeletonCard, SkeletonRows, SkeletonScreen, SkeletonTitle } from "@/kit";

/**
 * Каркас главной, пока она грузится (аудит поведения B-3): заголовок, карточка «что сейчас» с суммой, вторая сделка,
 * список заявок. Компьютер — колонка 760 px по центру, как у самой главной. Без мигания на быстрой сети (SkeletonScreen).
 */
export default function HomeLoading() {
  return (
    <SkeletonScreen className="desktop:mx-auto desktop:w-full desktop:max-w-home">
      <SkeletonTitle />
      <SkeletonCard lines={4} />
      <SkeletonCard lines={2} />
      <SkeletonRows rows={2} />
    </SkeletonScreen>
  );
}
