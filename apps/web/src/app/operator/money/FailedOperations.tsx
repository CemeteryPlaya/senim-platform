import Link from "next/link";
import { ru } from "@/i18n/ru";
import type { FailedOperation } from "@/modules/payments";
import { StatusBadge } from "@/ui";
import { formatDate, formatTiyn } from "@/ui/format";
import { ListCard } from "../_components/ListCard";
import { RetryOperationForm } from "./RetryOperationForm";

const t = ru.operator.money;

/** Отклонённые банком операции, которые ждут повтора оператором (ADR-009, «Повторы операций»). */
export function FailedOperations({ items }: { items: FailedOperation[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="money-failed-title" className="flex flex-col gap-4">
      <h2 id="money-failed-title" className="text-xl font-bold text-ink">
        {t.failedTitle}
      </h2>
      <p className="text-base text-ink-soft">{t.failedHint}</p>
      <ul className="flex flex-col gap-4">
        {items.map((op) => (
          <ListCard
            key={op.id}
            titleAs="h3"
            title={t.types[op.type]}
            badges={<StatusBadge tone="danger">{t.status.FAILED}</StatusBadge>}
            meta={[
              <Link key="deal" href={`/operator/deals/${op.dealId}`} className="text-primary underline">
                {t.deal(op.dealNumber, op.dealTitle)}
              </Link>,
              formatDate(op.failedAt),
              ...(op.error ? [t.failedReason(op.error)] : []),
            ]}
            aside={formatTiyn(op.amountTiyn)}
          >
            <RetryOperationForm transactionId={op.id} />
          </ListCard>
        ))}
      </ul>
    </section>
  );
}
