import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { ru } from "@/i18n/ru";
import { consentRevocationQueue } from "@/modules/identity";
import { Container, DateText, EmptyState, PageHeader, StatusBadge } from "@/ui";
import { DecisionQueue } from "../_components/DecisionQueue";
import { LIST_GRID, ListCard } from "../_components/ListCard";
import { requireOperatorPage } from "../_lib/guard";
import { ResolveForm } from "./ResolveForm";

const o = ru.operator;
const t = o.consents;

export const metadata: Metadata = { title: t.title };

const EMPTY_TITLE_ID = "consents-queue-empty";

/**
 * Очередь отзывов согласия на обработку ПДн (A.7 P6): открытые заявки, ближний срок первым (порядок identity); ФИО и
 * последние 4 цифры ИИН — из identity. Решение — «Отзыв исполнен» или отказ с причиной; срок — 15 рабочих дней.
 */
export default async function ConsentRevocationsPage() {
  const user = await requireOperatorPage("/operator/consents");
  const queue = await consentRevocationQueue(user);
  const now = new Date();

  return (
    <Container className="pb-10">
      <PageHeader title={t.title} description={t.description} back={{ href: "/operator", label: o.backToPanel }} />
      <DecisionQueue count={queue.length} emptyTitleId={EMPTY_TITLE_ID}>
        {queue.length === 0 ? (
          <EmptyState icon={<ShieldCheck />} title={t.empty} titleId={EMPTY_TITLE_ID} description={t.emptyHint} />
        ) : (
          <ul data-queue className={LIST_GRID}>
            {queue.map((item) => (
              <ListCard
                key={item.id}
                titleAs="h2"
                title={item.fullName ? t.person(item.fullName) : t.noName}
                badges={item.dueAt < now ? <StatusBadge tone="danger">{t.overdue}</StatusBadge> : undefined}
                meta={[
                  item.iinLast4 && t.iin(item.iinLast4),
                  <>
                    {t.requested} <DateText value={item.requestedAt} format="dateTime" />
                  </>,
                  <>
                    {t.due} <DateText value={item.dueAt} />
                  </>,
                ]}
              >
                <ResolveForm revocationId={item.id} />
              </ListCard>
            ))}
          </ul>
        )}
      </DecisionQueue>
    </Container>
  );
}
