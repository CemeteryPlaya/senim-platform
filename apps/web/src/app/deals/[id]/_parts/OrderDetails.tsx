import { ChevronDown } from "lucide-react";
import { daysLeft, type DealView } from "@/modules/deal-core";
import { ru } from "@/i18n/ru";
import { formatDays, KeyValueList } from "@/ui";
import { illustrationFor } from "@/app/_home/illustration";
import { heroImage, orderFacts } from "./deal-view";

const v = ru.deal.view;

/** Пока идут работы, срок важен: «Осталось N дней» — над строками. */
const COUNTING = new Set<DealView["status"]>(["PAID_HOLD", "IN_PROGRESS"]);

/**
 * «Подробнее о заказе» (решение 2.1.5): фото, мастер, сроки, гарантия, «Осталось N дней» — свёрнуто под текущим
 * событием (ход сделки — DealProgress наверху экрана). Нативный <details>: клавиатура и диктор без скриптов.
 */
export function OrderDetails({ deal, now }: { deal: DealView; now: Date }) {
  const image = heroImage({
    ready: deal.ready ? deal.ready.photos : [],
    progress: deal.progressReports.map((r) => r.photos),
    room: deal.subject.roomPhotos,
    illustration: illustrationFor(deal.title),
  });
  const planned = deal.dates.plannedReadyAt;
  const left = planned && COUNTING.has(deal.status) ? daysLeft(planned, now) : null;
  const rows = orderFacts({
    viewer: deal.viewer,
    executorLabel: deal.executorLabel,
    city: deal.subject.city,
    plannedReadyAt: planned,
    signedAt: deal.dates.signedAt,
    durationDays: deal.durationDays,
    warrantyMonths: deal.warrantyMonths,
  });

  return (
    <details className="group rounded-card border border-line bg-surface px-4">
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
        <KeyValueList rows={rows} />
      </div>
    </details>
  );
}
