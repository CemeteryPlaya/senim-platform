import type { Metadata } from "next";
import { needsPosition } from "@/features/deal-view/facts";
import { ru } from "@/i18n/ru";
import { dealContacts } from "@/modules/companies";
import { bankConsentState, type DealView } from "@/modules/deal-core";
import { readDealDocuments } from "@/modules/documents";
import type { CurrentUser } from "@/modules/identity";
import { getIncomingRequest } from "@/modules/requests";
import { getDevice, type Device } from "@/platform/device";
import { logger } from "@/platform/logger";
import { pageHref, partyDeal, requireV2User } from "../../../_shell/auth";
import { to } from "../../../_shell/paths";
import type { DealSide } from "../../../_shell/side";
import { dealChip, dealStepsView, masterConsentMissing, payWaitsMaster } from "../../_parts/deal-summary";
import {
  cancelText,
  dealHrefs,
  documentRows,
  HISTORY_SHOWN,
  historyView,
  masterMoneyView,
  moneyView,
  nowView,
  orderRows,
  reportsView,
  reviewRows,
} from "./_parts/deal-card";
import { DealCardView, type CardView } from "./_parts/DealCardView";

const t = ru.app.deal.card;
const tm = ru.app.masterDeal.card;

export const metadata: Metadata = { title: t.metaTitle };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Адрес заказа для мастера — только то, что отдаёт модуль заявок (`getIncomingRequest`: адрес — мастеру выбранного
 * предложения), и только после заключения оферты. Сбой чтения или неодобренный мастер (`notApproved`) не роняют карточку:
 * строки адреса просто нет.
 */
async function masterAddress(user: CurrentUser, deal: DealView): Promise<string | null> {
  if (deal.dates.signedAt === null) return null;
  try {
    return (await getIncomingRequest(user, deal.requestId)).address;
  } catch (error) {
    logger.warn("deal address failed", { dealId: deal.id, error });
    return null;
  }
}

/**
 * Карточка сделки стороны в активной роли (главный экран доверия): что сейчас и одно главное действие шага, деньги из
 * журнала, ход сделки, ход работ (мастер), заказ, документы, другая сторона (контакты — после оферты), история; отмена и
 * спор — в меню «Действия». Действие шага ведёт на свой экран (подпись, оплата, отзыв — покупатель; подпись, начало
 * работы, сдача — мастер). Ворота — `partyDeal`: сторона в другой своей роли — переключение роли, оператор — в v1, чужая и
 * несуществующая — 404. Документы читаются без выпуска выписки (`readDealDocuments`): открытие карточки ничего не пишет.
 */
export default async function DealPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireV2User(pageHref(`/deals/${encodeURIComponent(id)}`, sp));
  const { deal, side } = await partyDeal(user, id);
  const [documents, contacts, bank, address, device] = await Promise.all([
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
    side === "EXECUTOR" ? masterAddress(user, deal) : Promise.resolve(null),
    getDevice(),
  ]);
  return <DealCardView view={cardView({ deal, side, documents, contacts, bank, address, all: sp.history === "all", device })} device={device} />;
}

/**
 * «Ход работ» мастера: отчёты и ссылка на экран нового отчёта. Отчёт добавляется, пока идут работы (`can.addProgress`); в шаге
 * «Сдать работу» ссылка уже стоит под «Сейчас» (`addHref` — `null`) и здесь не повторяется. Ни отчётов, ни возможности
 * добавить (до начала работ, отменённая сделка) — блока нет.
 */
function reportsBlock(deal: DealView, addHref: string | null): CardView["reports"] {
  const items = reportsView(deal.progressReports);
  const add = deal.can.addProgress ? addHref : null;
  if (items.length === 0 && !deal.can.addProgress) return null;
  return { items, addHref: add };
}

type CardInput = {
  deal: DealView;
  side: DealSide;
  documents: Awaited<ReturnType<typeof readDealDocuments>>;
  contacts: Awaited<ReturnType<typeof dealContacts>>;
  bank: Awaited<ReturnType<typeof bankConsentState>> | null;
  address: string | null;
  all: boolean;
  device: Device;
};

/** Вид карточки по стороне: таблица «что сейчас», блок денег, другая сторона, ход работ и история — свои у каждой стороны. */
function cardView({ deal, side, documents, contacts, bank, address, all, device }: CardInput): CardView {
  const master = side === "EXECUTOR";
  const hrefs = dealHrefs(deal.id);
  const openDispute = deal.dispute?.status === "OPEN";
  const outcome = deal.dispute?.status === "RESOLVED" ? deal.dispute.outcome : null;
  const manual = deal.paymentProvider === "MANUAL";
  // Мастеру — его смета (`deal.estimate` модуля по стороне: цена − гарантия 4%) и журнал; сумм покупателя нет.
  const money = master
    ? masterMoneyView({ block: deal.moneyBlock, estimate: deal.estimate })
    : moneyView({ block: deal.moneyBlock, estimate: deal.estimate, snapshot: deal.money, manual });
  const now = nowView({
    id: deal.id,
    side,
    next: deal.next,
    contractId: deal.contract?.id ?? null,
    actId: deal.act?.id ?? null,
    contractPdf: documents.find((d) => d.kind === "CONTRACT")?.pdfUrl ?? null,
    payTiyn: master ? 0n : money.amount,
    manual,
    bank,
    plannedReadyAt: deal.dates.plannedReadyAt,
    needsPosition: deal.dispute !== null && needsPosition(deal.viewer, deal.dispute),
    refundAll: deal.moneyBlock.kind === "refunded",
    disputeOutcome: outcome,
  });
  return {
    id: deal.id,
    side,
    title: deal.title,
    lead: master ? tm.lead(deal.number) : t.lead(deal.number, deal.executorLabel),
    chip: dealChip({
      side,
      status: deal.status,
      hasOpenDispute: openDispute,
      next: deal.next,
      payWaitsMaster: payWaitsMaster(deal.next, bank),
      consentMissing: masterConsentMissing(deal.next, bank),
      money: deal.moneyBlock,
      paymentProvider: deal.paymentProvider,
    }),
    now,
    steps: dealStepsView(deal.status, openDispute, outcome, side),
    money: { ...money, historyHref: hrefs.money },
    order: orderRows({
      title: deal.title,
      city: deal.subject.city,
      address,
      plannedReadyAt: deal.dates.plannedReadyAt,
      signedAt: deal.dates.signedAt,
      durationDays: deal.durationDays,
      warrantyMonths: deal.warrantyMonths,
      // Плановую дату называет «Сейчас»: покупателю — «Мастер изготавливает мебель», мастеру — «Изготовьте мебель и сдайте работу».
      readyShownInNow: (now.kind === "wait-ready" || now.kind === "ready") && deal.dates.plannedReadyAt !== null,
    }),
    documents: documentRows(documents, outcome),
    party: {
      // Имени покупателя модуль экрану сделки не отдаёт: раздел «Покупатель» без строки имени.
      label: master ? null : deal.executorLabel,
      contacts,
      chatHref: to(`/chats/${encodeURIComponent(deal.offerId)}`),
    },
    reports: master ? reportsBlock(deal, now.kind === "ready" ? null : hrefs.progress) : null,
    review: reviewRows(deal.review),
    history: { ...historyView(deal.history, { all, limit: HISTORY_SHOWN[device] }, side), allHref: hrefs.history },
    actions: {
      cancelText: cancelText({ side, canCancel: deal.can.cancel, status: deal.status, block: deal.moneyBlock, manual }),
      disputeHref: deal.can.openDispute ? hrefs.dispute : null,
    },
  };
}
