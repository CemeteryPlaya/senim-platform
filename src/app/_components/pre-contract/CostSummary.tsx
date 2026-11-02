import { CalendarDays, ShieldCheck } from "lucide-react";
import { ru } from "@/i18n/ru";
import { formatDays, formatMonths, Money } from "@/ui";

const t = ru.requests.pre.project;

export type CostSummaryProps = {
  /** Расшифровка стоимости проекта; без неё — только итог. */
  lines?: readonly { title: string; amount: number }[];
  total: number;
  /** Подпись итоговой строки: «Итого», «Итоговая цена после замера». */
  totalLabel?: string;
  durationDays?: number;
  warrantyMonths?: number;
};

/**
 * Итоговая стоимость по макетам 8 и 9: строки расшифровки, мятная полоса «Итого» с крупной суммой,
 * плитки «Срок изготовления» и «Гарантия». Только данные проекта или замера — без выдуманных строк.
 */
export function CostSummary({ lines = [], total, totalLabel = t.totalRow, durationDays, warrantyMonths }: CostSummaryProps) {
  const tiles = [
    durationDays !== undefined && { icon: <CalendarDays />, label: t.durationTile, value: formatDays(durationDays) },
    warrantyMonths !== undefined && { icon: <ShieldCheck />, label: t.warrantyTile, value: formatMonths(warrantyMonths) },
  ].filter((x) => x !== false);
  return (
    <div className="flex flex-col gap-4">
      {lines.length > 0 && (
        <ul aria-label={t.costLines} className="flex flex-col divide-y divide-line">
          {lines.map((line, i) => (
            <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5 text-base">
              <span className="min-w-0 text-ink-soft">{line.title}</span>
              <Money amount={line.amount} className="font-semibold text-ink" />
            </li>
          ))}
        </ul>
      )}
      <p className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-control bg-accent-soft px-4 py-3">
        <span className="text-lg font-bold text-ink">{totalLabel}</span>
        <Money amount={total} className="text-2xl font-extrabold text-ink sm:text-3xl" />
      </p>
      {tiles.length > 0 && (
        <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] gap-3">
          {tiles.map((tile) => (
            <div key={tile.label} className="flex items-start gap-3 rounded-control border border-line bg-surface p-3">
              <span aria-hidden className="inline-flex size-10 shrink-0 items-center justify-center rounded-control bg-accent-soft text-primary [&_svg]:size-5">
                {tile.icon}
              </span>
              <div className="flex min-w-0 flex-col">
                <dt className="text-sm text-muted">{tile.label}</dt>
                <dd className="text-base font-bold text-ink">{tile.value}</dd>
              </div>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
