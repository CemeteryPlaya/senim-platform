import type { Metadata } from "next";
import { needsPosition } from "@/features/deal-view/facts";
import { ru } from "@/i18n/ru";
import { dealContacts } from "@/modules/companies";
import { bankConsentState } from "@/modules/deal-core";
import { listDealDocuments } from "@/modules/documents";
import { getDevice } from "@/platform/device";
import { pageHref } from "../../../_shell/auth";
import { to } from "../../../_shell/paths";
import { dealStatusText, dealStepsView, dealTone } from "../../_parts/deal-summary";
import { cancelText, dealHrefs, documentRows, historyView, moneyView, nowView, orderRows } from "./_parts/deal-card";
import { DealCardView, type CardView } from "./_parts/DealCardView";
import { buyerDeal } from "./_parts/gate";

const t = ru.app.deal.card;

export const metadata: Metadata = { title: t.metaTitle };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Карточка сделки покупателя (главный экран доверия): что сейчас и одно главное действие шага, ход сделки, деньги из
 * журнала, заказ, документы, мастер (контакты — после оферты), история; отмена и спор — в меню «Действия». Действие шага
 * ведёт на свой экран (подпись, оплата, отзыв). Чужая и несуществующая сделка — 404 (`buyerDeal`).
 */
export default async function DealPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const { user, deal } = await buyerDeal(pageHref(`/deals/${encodeURIComponent(id)}`, sp), id);
  const [documents, contacts, bank, device] = await Promise.all([
    listDealDocuments(user, deal.id),
    dealContacts(user, deal.id),
    // Отметки «Передача данных банку» есть только до оплаты.
    deal.status === "CREATED" ? bankConsentState(user, deal.id) : Promise.resolve(null),
    getDevice(),
  ]);

  const hrefs = dealHrefs(deal.id);
  const openDispute = deal.dispute?.status === "OPEN";
  const money = moneyView({ block: deal.moneyBlock, estimate: deal.estimate, snapshot: deal.money });
  const view: CardView = {
    id: deal.id,
    title: deal.title,
    lead: t.lead(deal.number, deal.executorLabel),
    chip: { text: dealStatusText(deal.status, openDispute), tone: dealTone({ status: deal.status, hasOpenDispute: openDispute, next: deal.next }) },
    now: nowView({
      id: deal.id,
      next: deal.next,
      contractId: deal.contract?.id ?? null,
      actId: deal.act?.id ?? null,
      payTiyn: money.amount,
      bank,
      plannedReadyAt: deal.dates.plannedReadyAt,
      needsPosition: deal.dispute !== null && needsPosition(deal.viewer, deal.dispute),
      refundAll: deal.moneyBlock.kind === "refunded",
    }),
    steps: dealStepsView(deal.status, openDispute, deal.next.action),
    money: { ...money, historyHref: hrefs.money },
    order: orderRows({
      title: deal.title,
      executorLabel: deal.executorLabel,
      city: deal.subject.city,
      plannedReadyAt: deal.dates.plannedReadyAt,
      signedAt: deal.dates.signedAt,
      durationDays: deal.durationDays,
      warrantyMonths: deal.warrantyMonths,
    }),
    documents: documentRows(documents),
    master: { label: deal.executorLabel, contacts, chatHref: to(`/chats/${encodeURIComponent(deal.offerId)}`) },
    history: { ...historyView(deal.history, sp.history === "all"), allHref: hrefs.history },
    actions: {
      cancelText: cancelText({ canCancel: deal.can.cancel, status: deal.status, block: deal.moneyBlock }),
      disputeHref: deal.can.openDispute ? hrefs.dispute : null,
    },
  };
  return <DealCardView view={view} device={device} />;
}
