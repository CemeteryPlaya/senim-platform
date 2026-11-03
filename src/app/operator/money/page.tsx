import type { Metadata } from "next";
import Link from "next/link";
import { Landmark } from "lucide-react";
import { ru } from "@/i18n/ru";
import { listFailedMoney, listMoneyQueue } from "@/modules/operator";
import { Alert, Container, EmptyState, PageHeader, StatusBadge } from "@/ui";
import { formatTiyn } from "@/ui/format";
import { DecisionQueue } from "../_components/DecisionQueue";
import { ListCard } from "../_components/ListCard";
import { requireOperatorPage } from "../_lib/guard";
import { FailedOperations } from "./FailedOperations";
import { OperationActions } from "./OperationForms";

const t = ru.operator.money;

export const metadata: Metadata = { title: t.title };

const EMPTY_TITLE_ID = "money-queue-empty";

/** Очередь операций manual, ждущих банковского документа (ТЗ п. 10): старые сверху. */
export default async function MoneyQueuePage() {
  const user = await requireOperatorPage("/operator/money");
  const queue = await listMoneyQueue(user);
  const failed = await listFailedMoney(user);

  return (
    <Container size="form" className="pb-10">
      <PageHeader title={t.title} description={t.description} back={{ href: "/operator", label: ru.operator.backToPanel }} />
      <div className="flex flex-col gap-6">
        <Alert tone="info">{t.rule}</Alert>
        <DecisionQueue count={queue.length} emptyTitleId={EMPTY_TITLE_ID}>
          {queue.length === 0 ? (
            <EmptyState icon={<Landmark />} title={t.empty} titleId={EMPTY_TITLE_ID} description={t.emptyHint} />
          ) : (
            <>
              <p className="text-base text-ink-soft">{t.once}</p>
              <ul data-queue className="flex flex-col gap-4">
                {queue.map((op) => (
                  <ListCard
                    key={op.id}
                    titleAs="h2"
                    title={t.types[op.type]}
                    badges={<StatusBadge tone={op.ageDays > 2 ? "warning" : "neutral"}>{t.waiting(op.ageDays)}</StatusBadge>}
                    meta={[
                      <Link key="deal" href={`/operator/deals/${op.dealId}`} className="text-primary underline">
                        {t.deal(op.dealNumber, op.dealTitle)}
                      </Link>,
                    ]}
                    aside={formatTiyn(op.amountTiyn)}
                  >
                    <OperationActions transactionId={op.id} type={op.type} />
                  </ListCard>
                ))}
              </ul>
            </>
          )}
        </DecisionQueue>
        <FailedOperations items={failed} />
      </div>
    </Container>
  );
}
