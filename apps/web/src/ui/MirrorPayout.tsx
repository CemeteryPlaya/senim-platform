import { ru } from "@/i18n/ru";
import { cn } from "./cn";
import { Money } from "./display";

const t = ru.payments.mirror;

export type MirrorPayoutProps = { payoutTiyn: bigint; guaranteeTiyn: bigint; className?: string };

/** Зеркальный расчёт мастера: «Вы получите после приёмки» и гарантия (4%). Суммы — тиыны, считает computeDealMoney. */
export function MirrorPayout({ payoutTiyn, guaranteeTiyn, className }: MirrorPayoutProps) {
  return (
    <div role="note" className={cn("flex flex-col gap-1 rounded-card bg-accent-soft p-4 text-ink", className)}>
      <span className="text-base text-ink-soft">{t.title}</span>
      <span className="text-2xl font-extrabold">
        <Money amount={payoutTiyn} />
      </span>
      <span className="text-base text-ink-soft">
        {t.guarantee} — <Money amount={guaranteeTiyn} />
      </span>
    </div>
  );
}
