import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FileText } from "lucide-react";
import { orNotFound } from "@/app/requests/_parts/guard";
import { getDealView } from "@/modules/deal-core";
import { listDealDocuments } from "@/modules/documents";
import { getCurrentUser, requireIntroduced } from "@/modules/identity";
import { ru } from "@/i18n/ru";
import { ButtonLink, Container, DateText, Money, PageHeader } from "@/ui";
import { MoneyBlock } from "../_parts/MoneyBlock";

const h = ru.payments.history;

export const metadata: Metadata = { title: h.title };

/**
 * «История денег» (решение 2.1.7) — тап по блоку денег: зарезервировано → удержано на время спора → выплачено
 * или возвращено, с датами, номерами операций и документами-основаниями. Только журнал (moneyHistory), не статус.
 */
export default async function MoneyHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/deals/${id}/money`)}`);
  requireIntroduced(user, `/deals/${id}/money`);
  const deal = await orNotFound(getDealView(user, id));
  // Выписка MONEY_STATEMENT (PDF) — documents выпускает её по журналу; до первой операции её нет.
  const statement = (await listDealDocuments(user, deal.id)).find((d) => d.kind === "MONEY_STATEMENT");

  return (
    <Container size="form" className="flex flex-col gap-6 pb-10">
      <PageHeader title={h.title} description={ru.deal.number(deal.number)} back={{ href: `/deals/${deal.id}`, label: ru.deal.number(deal.number) }} className="pb-0" />
      <MoneyBlock deal={deal} linked={false} />
      <section aria-labelledby="money-operations" className="flex flex-col gap-3">
        <h2 id="money-operations" className="text-xl font-bold text-ink">
          {ru.deal.view.moneyOperations}
        </h2>
        {deal.moneyHistory.length === 0 ? (
          <p className="text-base text-muted">{h.empty}</p>
        ) : (
          <ol className="flex flex-col divide-y divide-line border-y border-line">
            {deal.moneyHistory.map((item) => (
              <li key={item.id} className="flex flex-col gap-1 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span id={`op-${item.id}-type`} className="min-w-0 grow basis-[12em] text-lg font-semibold text-ink">
                    {h.type[item.type]}
                  </span>
                  <Money amount={item.amountTiyn} className="shrink-0 text-lg font-bold text-ink" />
                </div>
                <span id={`op-${item.id}-at`} className="text-base text-muted">
                  <DateText value={item.at} format="dateTime" />
                </span>
                {item.status !== "SUCCEEDED" && <span className="text-base font-semibold text-warning">{h.status[item.status]}</span>}
                {item.operationRef && <span className="text-base text-muted">{ru.payments.block.operationRef(item.operationRef)}</span>}
                {item.isTest && <span className="text-base text-muted">{h.testMark}</span>}
                {/* Ссылок «Документ-основание» несколько: описание — операция и её дата, имя ссылки прежнее. */}
                {item.basisDocumentId && (
                  <a
                    href={`/api/documents/${item.basisDocumentId}/pdf`}
                    aria-describedby={`op-${item.id}-type op-${item.id}-at`}
                    className="inline-flex min-h-control-sm items-center gap-2 self-start text-base font-semibold text-primary"
                  >
                    <FileText aria-hidden className="size-5" />
                    {h.basis}
                  </a>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
      {statement && (
        <ButtonLink href={statement.pdfUrl} variant="secondary" icon={<FileText />}>
          {h.statement}
        </ButtonLink>
      )}
    </Container>
  );
}
