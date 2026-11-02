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
 * Итоговая стоимость по макетам 8 и 9, минималистично: строки расшифровки, «Итого» крупной суммой под линией,
 * затем строки «Срок изготовления» и «Гарантия». Только данные проекта или замера — без выдуманных строк.
 */
export function CostSummary({ lines = [], total, totalLabel = t.totalRow, durationDays, warrantyMonths }: CostSummaryProps) {
  const terms = [
    durationDays !== undefined && { label: t.durationTile, value: formatDays(durationDays) },
    warrantyMonths !== undefined && { label: t.warrantyTile, value: formatMonths(warrantyMonths) },
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
      <p className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-line pt-3">
        <span className="text-lg font-bold text-ink">{totalLabel}</span>
        <Money amount={total} className="text-2xl font-extrabold text-ink sm:text-3xl" />
      </p>
      {terms.length > 0 && (
        <dl className="flex flex-col divide-y divide-line">
          {terms.map((row) => (
            <div key={row.label} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5 text-base">
              <dt className="text-muted">{row.label}</dt>
              <dd className="font-semibold text-ink">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
