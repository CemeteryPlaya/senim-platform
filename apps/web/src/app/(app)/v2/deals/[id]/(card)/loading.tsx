import { SkeletonCard, SkeletonRows, SkeletonScreen, SkeletonTitle, Split } from "@/kit";

/**
 * Каркас карточки сделки (аудит поведения B-3): «‹ Сделки», название, номер и чип статуса; слева «Сейчас / Дальше» и ход
 * сделки, справа деньги и заказ (на телефоне — одной колонкой, как у `Split`). Ворота доступа (layout.tsx) уже пройдены:
 * чужая сделка до каркаса не доходит.
 */
export default function DealLoading() {
  return (
    <SkeletonScreen>
      <SkeletonTitle back lead chip />
      <Split
        main={
          <div className="flex flex-col gap-stack-section">
            <SkeletonCard lines={3} />
            <SkeletonCard lines={2} headline={false} />
          </div>
        }
        aside={
          <div className="flex flex-col gap-stack-section">
            <SkeletonCard lines={4} />
            <SkeletonRows rows={2} />
          </div>
        }
      />
    </SkeletonScreen>
  );
}
