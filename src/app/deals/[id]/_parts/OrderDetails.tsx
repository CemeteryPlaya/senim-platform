import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { daysLeft, type DealView } from "@/modules/deal-core";
import { ru } from "@/i18n/ru";
import { DateText, formatDays, formatMonths, Stepper } from "@/ui";
import { illustrationFor } from "@/app/_home/illustration";
import { dealStep, heroImage } from "./deal-view";

const v = ru.deal.view;

/** Пока идут работы, срок важен: «Осталось N дней» — над строками. */
const COUNTING = new Set<DealView["status"]>(["PAID_HOLD", "IN_PROGRESS"]);

/**
 * «Подробнее о заказе» (решение 2.1.5): всё, что раньше стояло наверху — фото, мастер, сроки, гарантия, шкала хода
 * сделки, «Осталось N дней», — свёрнуто под блоком денег. Нативный <details>: клавиатура и диктор без скриптов.
 */
export function OrderDetails({ deal, now }: { deal: DealView; now: Date }) {
  const image = heroImage({
    ready: deal.ready ? deal.ready.photos : [],
    progress: deal.progressReports.map((r) => r.photos),
    room: deal.subject.roomPhotos,
    illustration: illustrationFor(deal.title),
  });
  const step = dealStep(deal.status, deal.dates.signedAt !== null);
  const planned = deal.dates.plannedReadyAt;
  const left = planned && COUNTING.has(deal.status) ? daysLeft(planned, now) : null;
  const rows: { label: string; value: ReactNode }[] = [
    deal.viewer === "EXECUTOR" ? { label: v.client, value: ru.deal.clientLabel } : { label: v.executor, value: deal.executorLabel },
    ...(deal.subject.city ? [{ label: v.city, value: deal.subject.city }] : []),
    ...(planned ? [{ label: v.plannedReady, value: <DateText value={planned} /> }] : []),
    { label: v.duration, value: formatDays(deal.durationDays) },
    { label: v.warranty, value: formatMonths(deal.warrantyMonths) },
    ...(deal.dates.signedAt ? [{ label: v.signedAt, value: <DateText value={deal.dates.signedAt} /> }] : []),
  ];

  return (
    <details className="group border-y border-line">
      <summary className="flex min-h-control cursor-pointer list-none items-center justify-between gap-3 py-3 text-lg font-bold text-ink [&::-webkit-details-marker]:hidden">
        {ru.deal.sections.details}
        <ChevronDown aria-hidden className="size-6 shrink-0 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="flex flex-col gap-5 pb-5">
        {image && (
          // Фото сдачи, отчёта или помещения — уже в размере для экрана; оптимизатор не нужен.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt={deal.title} className="aspect-[4/3] w-full rounded-card bg-sunken object-cover" />
        )}
        <h3 className="text-xl font-bold break-words text-ink">{deal.title}</h3>
        {left !== null && <p className="text-lg font-bold text-ink">{v.daysLeft(formatDays(left))}</p>}
        {step !== null && <Stepper steps={v.steps} current={step} label={v.stepsLabel} />}
        <dl className="flex flex-col divide-y divide-line">
          {rows.map((row) => (
            <div key={row.label} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5 text-base">
              <dt className="text-muted">{row.label}</dt>
              <dd className="text-ink">{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </details>
  );
}
