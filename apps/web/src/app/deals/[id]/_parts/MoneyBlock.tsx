import Link from "next/link";
import { AlertTriangle, CheckCircle2, ChevronRight, Clock, Lock, PauseCircle, Undo2 } from "lucide-react";
import type { ReactNode } from "react";
import type { DealView } from "@/modules/deal-core";
import { ru } from "@/i18n/ru";
import { cn } from "@/ui";
import { estimateRows } from "./deal-view";
import { moneyPanel, type MoneyIcon, type MoneyTone } from "./money-panel";

// Вид v2: карточка с цветной рамкой и значком в круге; цвет — только в помощь, смысл несут значок и заголовок.
const TONE: Record<MoneyTone, string> = {
  neutral: "border-line bg-surface",
  success: "border-success bg-success-soft",
  warning: "border-warning bg-warning-soft",
};
const ICON_TONE: Record<MoneyTone, string> = { neutral: "bg-sunken text-ink-soft", success: "bg-surface text-success", warning: "bg-surface text-warning" };
const ICON: Record<MoneyIcon, ReactNode> = {
  clock: <Clock />,
  alert: <AlertTriangle />,
  lock: <Lock />,
  pause: <PauseCircle />,
  check: <CheckCircle2 />,
  undo: <Undo2 />,
};

export const partyOf = (deal: DealView): "CLIENT" | "EXECUTOR" => (deal.viewer === "EXECUTOR" ? "EXECUTOR" : "CLIENT");

/**
 * Первый блок карточки сделки — деньги (ТЗ п. 4.1): только из журнала. Тап — «История денег».
 * Цвет — в помощь: смысл несут значок и заголовок.
 */
export function MoneyBlock({ deal, linked = true }: { deal: DealView; linked?: boolean }) {
  const p = moneyPanel(deal.moneyBlock, partyOf(deal), deal.money.payoutTiyn);
  const box = cn("flex gap-4 rounded-card border-2 p-5 text-ink", TONE[p.tone]);
  const body = (
    <>
      <span aria-hidden className={cn("flex size-12 shrink-0 items-center justify-center rounded-full [&_svg]:size-7", ICON_TONE[p.tone])}>
        {ICON[p.icon]}
      </span>
      <span className="flex min-w-0 grow flex-col gap-1">
        <span className="text-xl font-extrabold break-words">{p.title}</span>
        {p.lines.map((line) => (
          <span key={line} className="text-base text-ink-soft">
            {line}
          </span>
        ))}
        {p.testNote && <span className="text-base font-semibold text-ink-soft">{p.testNote}</span>}
        {linked && (
          <span className="mt-2 inline-flex items-center gap-1 text-base font-semibold">
            {ru.payments.block.openHistory}
            <ChevronRight aria-hidden className="size-5" />
          </span>
        )}
      </span>
    </>
  );
  return (
    <section aria-labelledby="money-title">
      <h2 id="money-title" className="sr-only">
        {ru.deal.sections.money}
      </h2>
      {linked ? (
        <Link href={`/deals/${deal.id}/money`} className={cn(box, "no-underline transition-[filter] duration-150 hover:brightness-[0.97] motion-reduce:transition-none")}>
          {body}
        </Link>
      ) : (
        <div className={box}>{body}</div>
      )}
    </section>
  );
}

/** Смета до подтверждения оплаты (ТЗ п. 5): покупателю — к оплате, мастеру — к выплате. */
export function Estimate({ deal }: { deal: DealView }) {
  if (deal.moneyBlock.kind !== "awaiting") return null;
  return (
    <section aria-labelledby="estimate-title" className="flex flex-col gap-2">
      <h2 id="estimate-title" className="text-lg font-bold text-ink">
        {ru.payments.estimate.title}
      </h2>
      <dl className="flex flex-col divide-y divide-line">
        {estimateRows(deal.estimate).map((row) => (
          <div key={row.label} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
            <dt className={row.total ? "text-lg font-bold text-ink" : "text-base text-muted"}>{row.label}</dt>
            <dd className={cn("tabular-nums", row.total ? "text-lg font-bold text-ink" : "text-base text-ink")}>{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
