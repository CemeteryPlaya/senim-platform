import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { orNotFound } from "@/app/requests/_parts/guard";
import { getDealView } from "@/modules/deal-core";
import { getCurrentUser, requireIntroduced } from "@/modules/identity";
import { ru } from "@/i18n/ru";
import { Container, formatDate, formatDateTime, Money, PageHeader } from "@/ui";
import { PrintButton } from "./PrintButton";

const s = ru.payments.statement;
const h = ru.payments.history;

export const metadata: Metadata = { title: h.statement };

/**
 * Печатаемая выписка по деньгам сделки — адаптер до PDF MONEY_STATEMENT (documents): те же строки журнала,
 * что в «Истории денег», таблицей для печати или «Сохранить как PDF». INTEGRATOR: см. ../statement-link.ts.
 */
export default async function StatementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/deals/${id}/money/statement`)}`);
  requireIntroduced(user, `/deals/${id}/money/statement`);
  const deal = await orNotFound(getDealView(user, id));
  const formed = new Date();

  return (
    <Container size="form" className="flex flex-col gap-6 pb-10">
      <PageHeader title={s.title(deal.number)} description={deal.title} back={{ href: `/deals/${deal.id}/money`, label: h.title }} className="pb-0 print:[&_a]:hidden" />
      <p className="text-base text-muted">{s.formedAt(formatDateTime(formed))}</p>
      <dl className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-y border-line py-3 text-base">
        <dt className="text-muted">{s.priceRow}</dt>
        <dd className="font-semibold text-ink">
          <Money amount={deal.money.priceTiyn} />
        </dd>
      </dl>
      {deal.moneyHistory.length === 0 ? (
        <p className="text-base text-muted">{h.empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-base">
            <thead>
              <tr className="border-b border-line-strong">
                <th scope="col" className="py-2 pr-3 font-semibold text-ink">{s.columns.date}</th>
                <th scope="col" className="py-2 pr-3 font-semibold text-ink">{s.columns.operation}</th>
                <th scope="col" className="py-2 pr-3 font-semibold text-ink">{s.columns.ref}</th>
                <th scope="col" className="py-2 text-right font-semibold text-ink">{s.columns.amount}</th>
              </tr>
            </thead>
            <tbody>
              {deal.moneyHistory.map((item) => (
                <tr key={item.id} className="border-b border-line align-top">
                  <td className="py-2 pr-3 text-ink">{formatDate(item.at)}</td>
                  <td className="py-2 pr-3 text-ink">
                    {h.type[item.type]}
                    {item.status !== "SUCCEEDED" && <span className="block text-muted">{h.status[item.status]}</span>}
                    {item.isTest && <span className="block text-muted">{h.testMark}</span>}
                  </td>
                  <td className="py-2 pr-3 break-all text-ink">{item.operationRef ?? ""}</td>
                  <td className="py-2 text-right whitespace-nowrap text-ink">
                    <Money amount={item.amountTiyn} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <PrintButton label={s.print} />
    </Container>
  );
}
