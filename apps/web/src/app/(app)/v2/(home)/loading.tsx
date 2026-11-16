import { SkeletonCard, SkeletonScreen, SkeletonTitle } from "@/kit";

/**
 * Каркас главной (аудит поведения B-3) — нейтральный: заголовок и две карточки. Маршрут один для гостя (лендинг),
 * покупателя и мастера, а `loading.tsx` не знает, кто открыл, поэтому каркас не повторяет главную покупателя. Компьютер —
 * колонка 760 px по центру. Без мигания на быстрой сети (SkeletonScreen).
 */
export default function HomeLoading() {
  return (
    <SkeletonScreen className="desktop:mx-auto desktop:w-full desktop:max-w-home">
      <SkeletonTitle />
      <SkeletonCard lines={3} />
      <SkeletonCard lines={2} />
    </SkeletonScreen>
  );
}
