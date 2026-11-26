import type { Metadata } from "next";
import { formatDateTime } from "@/features/format/format";
import { ru } from "@/i18n/ru";
import { astanaDate } from "@/platform/astana";
import { DecisionQueue, Money, PageTitle, QueueCard, Section, Stack, TextLink } from "@/kit";
import { listFailedMoney, listMoneyQueue } from "@/modules/operator";
import { getDevice } from "@/platform/device";
import { requireOperator } from "../../../_shell/auth";
import { to } from "../../../_shell/paths";
import { OperationDecision, RetryForm } from "./_parts/OperationDecision";

const q = ru.app.operatorQueues;
const t = q.money;

export const metadata: Metadata = { title: t.metaTitle };

/** Сегодня по Астане в формате поля даты: документ банка по умолчанию сегодняшний и не из будущего. */

/** Сумма операции и ссылка на сделку — над формой решения: что подтверждаем и где посмотреть подробности. */
function OperationFacts({ amountTiyn, dealId, dealNumber, dealTitle }: { amountTiyn: bigint; dealId: string; dealNumber: number; dealTitle: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-title-2 text-ink">
        <Money tiyn={amountTiyn} large />
      </p>
      <TextLink href={to(`/operator/deals/${encodeURIComponent(dealId)}`)}>{t.deal(dealNumber, dealTitle)}</TextLink>
    </div>
  );
}

/**
 * Деньги в банке (ТЗ п. 10): операции провайдера manual ждут документа банка — старые сверху. Каждая карточка: что за
 * операция, сумма, сделка, сколько ждёт; решение — подтверждение с номером, датой и сканом документа или «Банк отклонил
 * операцию» с причиной. Ниже — отклонённые банком операции с повтором. Все решения — со свежим кодом из приложения
 * (протокол кода в форме). Карточки равноправны: главной кнопки нет. Очередь держит фокус и объявляет итог
 * (`DecisionQueue`).
 */
export default async function MoneyQueuePage() {
  const user = await requireOperator(to("/operator/money"));
  const [queue, failed, device] = await Promise.all([listMoneyQueue(user), listFailedMoney(user), getDevice()]);
  const today = astanaDate(new Date());

  return (
    <Stack gap="section">
      <PageTitle title={t.title} lead={t.lead} />
      <DecisionQueue count={queue.length} label={t.queueLabel} empty={t.empty}>
        {queue.map((op) => (
          <QueueCard key={op.id} title={t.types[op.type]} meta={t.waiting(op.ageDays)}>
            <OperationFacts amountTiyn={op.amountTiyn} dealId={op.dealId} dealNumber={op.dealNumber} dealTitle={op.dealTitle} />
            <OperationDecision device={device} transactionId={op.id} type={op.type} today={today} />
          </QueueCard>
        ))}
      </DecisionQueue>
      {failed.length > 0 && (
        <Section title={t.failedTitle} id="failed">
          <p className="text-body text-muted desktop:max-w-measure">{t.failedLead}</p>
          <DecisionQueue count={failed.length} label={t.failedLabel} empty={t.failedEmpty}>
            {failed.map((op) => (
              <QueueCard
                key={op.id}
                headingLevel={3}
                title={t.types[op.type]}
                meta={[t.failedAt(formatDateTime(op.failedAt)), ...(op.error ? [t.failedReason(op.error)] : [])].join(" · ")}
              >
                <OperationFacts amountTiyn={op.amountTiyn} dealId={op.dealId} dealNumber={op.dealNumber} dealTitle={op.dealTitle} />
                <RetryForm transactionId={op.id} />
              </QueueCard>
            ))}
          </DecisionQueue>
        </Section>
      )}
    </Stack>
  );
}
