import type { Metadata } from "next";
import { ru } from "@/i18n/ru";
import { listDealDocuments } from "@/modules/documents";
import { getDevice } from "@/platform/device";
import { pageHref } from "../../../../_shell/auth";
import { documentRows, moneyView, dealHrefs } from "../_parts/deal-card";
import { buyerDeal } from "../_parts/gate";
import { MoneyHistoryView } from "./MoneyHistoryView";
import { operationRows } from "./money-view";

const t = ru.app.deal.money;

export const metadata: Metadata = { title: t.metaTitle };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * История денег сделки (тап по блоку денег на карточке): блок денег и операции — только из журнала (`moneyBlock`,
 * `moneyHistory`), не из статуса; документы-основания, выписка и акт со ссылкой «Поделиться». Чужая сделка — 404.
 */
export default async function MoneyHistoryPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const { user, deal } = await buyerDeal(pageHref(`/deals/${encodeURIComponent(id)}/money`, sp), id);
  const [documents, device] = await Promise.all([listDealDocuments(user, deal.id), getDevice()]);
  const rows = documentRows(documents);
  const shown = documents.filter((d) => d.kind === "MONEY_STATEMENT" || d.kind === "ACCEPTANCE_ACT");
  return (
    <MoneyHistoryView
      device={device}
      model={{
        dealTitle: deal.title,
        backHref: dealHrefs(deal.id).card,
        number: deal.number,
        money: moneyView({ block: deal.moneyBlock, estimate: deal.estimate, snapshot: deal.money, manual: deal.paymentProvider === "MANUAL" }),
        operations: operationRows(deal.moneyHistory, { manual: deal.paymentProvider === "MANUAL" }),
        documents: shown.flatMap((d) => {
          const row = rows.find((r) => r.id === d.id);
          return row ? [{ ...row, shareable: d.shareable, statement: d.kind === "MONEY_STATEMENT" }] : [];
        }),
      }}
    />
  );
}
