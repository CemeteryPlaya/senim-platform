import type { Metadata } from "next";
import { needsPosition } from "@/features/deal-view/facts";
import { ru } from "@/i18n/ru";
import { dealContacts } from "@/modules/companies";
import { bankConsentState } from "@/modules/deal-core";
import { readDealDocuments } from "@/modules/documents";
import { getDevice } from "@/platform/device";
import { logger } from "@/platform/logger";
import { pageHref } from "../../../_shell/auth";
import { to } from "../../../_shell/paths";
import { dealStatusText, dealStepsView, dealTone, payWaitsMaster, paymentWait } from "../../_parts/deal-summary";
import { cancelText, dealHrefs, documentRows, HISTORY_SHOWN, historyView, moneyView, nowView, orderRows, reviewRows } from "./_parts/deal-card";
import { DealCardView, type CardView } from "./_parts/DealCardView";
import { buyerDeal } from "./_parts/gate";

const t = ru.app.deal.card;

export const metadata: Metadata = { title: t.metaTitle };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Карточка сделки покупателя (главный экран доверия): что сейчас и одно главное действие шага, деньги из журнала, ход
 * сделки, заказ, документы, мастер (контакты — после оферты), история; отмена и спор — в меню «Действия». Действие шага
 * ведёт на свой экран (подпись, оплата, отзыв). Чужая и несуществующая сделка — 404 (`buyerDeal`). Документы читаются без
 * выпуска выписки (`readDealDocuments`): открытие карточки ничего не пишет.
 */
export default async function DealPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const { user, deal } = await buyerDeal(pageHref(`/deals/${encodeURIComponent(id)}`, sp), id);
  const [documents, contacts, bank, device] = await Promise.all([
    readDealDocuments(user, deal.id),
    dealContacts(user, deal.id),
    // Отметки «Передача данных банку» есть только до оплаты. Сбой чтения не роняет карточку: кнопка оплаты остаётся
    // (модуль сам откажет, если отметки нет).
    deal.status === "CREATED"
      ? bankConsentState(user, deal.id).catch((error: unknown) => {
          logger.warn("bank consent state failed", { dealId: deal.id, error });
          return null;
        })
      : Promise.resolve(null),
    getDevice(),
  ]);

  const hrefs = dealHrefs(deal.id);
  const openDispute = deal.dispute?.status === "OPEN";
  const outcome = deal.dispute?.status === "RESOLVED" ? deal.dispute.outcome : null;
  const manual = deal.paymentProvider === "MANUAL";
  const money = moneyView({ block: deal.moneyBlock, estimate: deal.estimate, snapshot: deal.money, manual });
  const now = nowView({
    id: deal.id,
    next: deal.next,
    contractId: deal.contract?.id ?? null,
    actId: deal.act?.id ?? null,
    contractPdf: documents.find((d) => d.kind === "CONTRACT")?.pdfUrl ?? null,
    payTiyn: money.amount,
    manual,
    bank,
    plannedReadyAt: deal.dates.plannedReadyAt,
    needsPosition: deal.dispute !== null && needsPosition(deal.viewer, deal.dispute),
    refundAll: deal.moneyBlock.kind === "refunded",
    disputeOutcome: outcome,
  });
  const view: CardView = {
    id: deal.id,
    title: deal.title,
    lead: t.lead(deal.number, deal.executorLabel),
    chip: {
      text: dealStatusText(deal.status, openDispute, paymentWait({ status: deal.status, money: deal.moneyBlock, paymentProvider: deal.paymentProvider })),
      tone: dealTone({ status: deal.status, hasOpenDispute: openDispute, next: deal.next, payWaitsMaster: payWaitsMaster(deal.next, bank) }),
    },
    now,
    steps: dealStepsView(deal.status, openDispute, deal.next.action, outcome),
    money: { ...money, historyHref: hrefs.money },
    order: orderRows({
      title: deal.title,
      city: deal.subject.city,
      plannedReadyAt: deal.dates.plannedReadyAt,
      signedAt: deal.dates.signedAt,
      durationDays: deal.durationDays,
      warrantyMonths: deal.warrantyMonths,
      readyShownInNow: now.kind === "wait-ready" && deal.dates.plannedReadyAt !== null,
    }),
    documents: documentRows(documents),
    master: { label: deal.executorLabel, contacts, chatHref: to(`/chats/${encodeURIComponent(deal.offerId)}`) },
    review: reviewRows(deal.review),
    history: { ...historyView(deal.history, { all: sp.history === "all", limit: HISTORY_SHOWN[device] }), allHref: hrefs.history },
    actions: {
      cancelText: cancelText({ canCancel: deal.can.cancel, status: deal.status, block: deal.moneyBlock, manual }),
      disputeHref: deal.can.openDispute ? hrefs.dispute : null,
    },
  };
  return <DealCardView view={view} device={device} />;
}
