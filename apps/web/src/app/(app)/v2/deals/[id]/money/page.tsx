import type { Metadata } from "next";
import { ru } from "@/i18n/ru";
import type { DealView } from "@/modules/deal-core";
import { listDealDocuments } from "@/modules/documents";
import type { CurrentUser } from "@/modules/identity";
import { getDevice, type Device } from "@/platform/device";
import { pageHref, partyDeal, requireV2User } from "../../../../_shell/auth";
import type { DealSide } from "../../../../_shell/side";
import { documentRows, dealHrefs, masterMoneyView, moneyView } from "../_parts/deal-card";
import { MoneyHistoryView, type MoneyHistoryModel } from "./MoneyHistoryView";
import { masterOperationRows, operationRows } from "./money-view";

export const metadata: Metadata = { title: ru.app.deal.money.metaTitle };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Покупателю — блок денег, операции, выписка и акт («Поделиться»); выписка по деньгам выпускается здесь же (`listDealDocuments`). */
async function buyerModel(user: CurrentUser, deal: DealView): Promise<MoneyHistoryModel> {
  const documents = await listDealDocuments(user, deal.id);
  const rows = documentRows(documents);
  const shown = documents.filter((d) => d.kind === "MONEY_STATEMENT" || d.kind === "ACCEPTANCE_ACT");
  const manual = deal.paymentProvider === "MANUAL";
  return {
    side: "CLIENT",
    dealTitle: deal.title,
    backHref: dealHrefs(deal.id).card,
    number: deal.number,
    money: moneyView({ block: deal.moneyBlock, estimate: deal.estimate, snapshot: deal.money, manual }),
    operations: operationRows(deal.moneyHistory, { manual, kinds: new Map(documents.map((d) => [d.id, d.kind])) }),
    documents: shown.flatMap((d) => {
      const row = rows.find((r) => r.id === d.id);
      return row ? [{ ...row, shareable: d.shareable }] : [];
    }),
  };
}

/**
 * Мастеру — блок денег мастера (смета мастера и журнал), операции его денег; выписки и акта нет: в них суммы покупателя
 * (оплата с защитой сделки 2%, возврат). «Вы получите» под оплатой — пока оплата вам не раскрыта.
 */
function masterModel(deal: DealView): MoneyHistoryModel {
  const kind = deal.moneyBlock.kind;
  const youGetTiyn = kind === "awaiting" || kind === "protected" || kind === "frozen" ? deal.estimate.totalTiyn : null;
  return {
    side: "EXECUTOR",
    dealTitle: deal.title,
    backHref: dealHrefs(deal.id).card,
    number: deal.number,
    money: masterMoneyView({ block: deal.moneyBlock, estimate: deal.estimate }),
    operations: masterOperationRows(deal.moneyHistory, { manual: deal.paymentProvider === "MANUAL", youGetTiyn }),
    documents: null,
  };
}

const modelOf = (side: DealSide, user: CurrentUser, deal: DealView): Promise<MoneyHistoryModel> => (side === "CLIENT" ? buyerModel(user, deal) : Promise.resolve(masterModel(deal)));

/**
 * История денег сделки стороны (тап по блоку денег на карточке): блок денег и операции — только из журнала (`moneyBlock`,
 * `moneyHistory`), не из статуса. Покупателю — документы-основания, выписка и акт со ссылкой «Поделиться»; мастеру — его
 * деньги без сумм покупателя. Ворота — `partyDeal`: другая роль — переключение, оператор — тот же экран v1, чужая — 404.
 */
export default async function MoneyHistoryPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const here = pageHref(`/deals/${encodeURIComponent(id)}/money`, sp);
  const user = await requireV2User(here);
  const { deal, side } = await partyDeal(user, id, { here, operatorTo: `/deals/${encodeURIComponent(id)}/money` });
  const [model, device]: [MoneyHistoryModel, Device] = await Promise.all([modelOf(side, user, deal), getDevice()]);
  return <MoneyHistoryView device={device} model={model} />;
}
