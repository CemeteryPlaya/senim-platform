import type { ReactNode } from "react";
import { cn } from "./cn";

export type StatProps = {
  /** Подпись («Новые заявки»). Диктор читает её первой, на экране она под числом. */
  label: string;
  /** Число или сумма: строка, `<Money />` и т. п. Не считается здесь. */
  value: ReactNode;
  /** Меньший кегль значения (22 px, text-title-2, вместо 28 px, text-amount). Для сумм в тенге на телефоне задавайте `compact`: значение не переносится, а крупная сумма в 390 px не помещается. */
  compact?: boolean;
};

/**
 * Число с подписью: крупное значение, под ним вторичная подпись. Без плитки, значка и рамки — стоит прямо на подложке
 * (в `StatRow` или `Card`). Разметка — `dl` с одной парой «термин — значение» (подпись перед значением для диктора,
 * на экране порядок обратный). Серверный компонент.
 */
export function Stat({ label, value, compact = false }: StatProps) {
  return (
    <dl className="m-0 flex min-w-0 flex-col-reverse gap-1">
      <dt className="text-sub wrap-break-word text-muted">{label}</dt>
      <dd className={cn("m-0 min-w-0 font-semibold whitespace-nowrap tabular-nums text-ink", compact ? "text-title-2" : "text-amount")}>{value}</dd>
    </dl>
  );
}

export type StatRowProps = {
  /** Имя группы для диктора («Сводка»). */
  label: string;
  /** Несколько `Stat`. */
  children: ReactNode;
};

/**
 * Строка сводки: два-три `Stat` на одной белой подложке (`surface`), переносятся на следующую строку, когда тесно.
 * Один блок, а не ряд плиток. Серверный компонент.
 */
export function StatRow({ label, children }: StatRowProps) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-x-8 gap-y-4 overflow-hidden rounded-card bg-surface p-5 *:flex-1 *:basis-32">
      {children}
    </div>
  );
}
