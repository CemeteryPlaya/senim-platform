import type { MoneyTransactionStatus } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { recordAudit } from "@/modules/audit";
import { actorOf, type CurrentUser } from "@/modules/identity";
import { computeDealMoney, newDealProviderKind } from "@/modules/payments";
import { db, isUniqueViolation, transaction, type Tx } from "@/platform/db";
import { env } from "@/platform/env";
import { fail } from "@/platform/errors";
import { isEnabled } from "@/platform/features";
import { checkGps, type GpsCheck } from "@/platform/geo";
import { parseInput } from "@/platform/validation";
import type { CreateDeal, OnDocumentSigned } from "./contracts";
import { notifyBoth, notifyParty, otherParty, partyText, SYSTEM_ACTOR } from "./effects";
import { processDealMoney, requestHold, requestPayout, requestRefund } from "./money";
import { dealParties, requireBankConsents } from "./bank-consent";
import { applyPortfolioConsent, attachOwnFiles, documents, recalculateRating, requests } from "./ports";
import { cancelDealSchema, createDealSchema, dealRefSchema, progressReportSchema, reviewSchema, submitReadySchema } from "./schemas";
import { contextOf, lockDeal, moveDeal, refuse, requireParty, requireRole, scopeOf, type DealState } from "./state";

const t = ru.deal.notify;
const e = ru.deal.errors;

// ─── оферта ──────────────────────────────────────────────────────────────────

/**
 * requests → deal-core: акцепт цены в торге. Деньги — снимок computeDealMoney(X) (CHECK в БД держит формулы),
 * провайдер — из env на момент создания, демо — от покупателя. Оферта — порт documents.createContract.
 */
export const createDeal: CreateDeal = async (tx, raw) => {
  const input = parseInput(createDealSchema, raw);
  const offer = await tx.offer.findUnique({
    where: { id: input.offerId },
    select: {
      requestId: true,
      executorId: true,
      durationDays: true,
      warrantyMonths: true,
      request: { select: { clientId: true, client: { select: { isDemo: true } } } },
      executor: { select: { userId: true } },
    },
  });
  if (!offer || offer.requestId !== input.requestId) return fail.validation(e.badDealInput);
  // Самосделка: покупатель и мастер — один человек в двух ролях (ADR-004).
  if (offer.executor.userId === offer.request.clientId) return fail.conflict(e.selfDeal);
  const money = computeDealMoney(input.priceTiyn);
  const paymentProvider = newDealProviderKind(env());

  let dealId: string;
  try {
    const created = await tx.deal.create({
      data: {
        requestId: input.requestId,
        offerId: input.offerId,
        clientId: offer.request.clientId,
        executorId: offer.executorId,
        title: input.title,
        ...money,
        durationDays: offer.durationDays,
        warrantyMonths: offer.warrantyMonths,
        paymentProvider,
        isDemo: offer.request.client.isDemo,
      },
      select: { id: true },
    });
    dealId = created.id;
  } catch (err) {
    if (isUniqueViolation(err)) return fail.conflict(e.dealExists);
    throw err;
  }

  await recordAudit(tx, {
    actor: raw.actor ?? SYSTEM_ACTOR,
    action: "deal.created",
    entity: { type: "deal", id: dealId },
    scope: scopeOf(dealId),
    after: { status: "CREATED", priceTiyn: String(money.priceTiyn), buyerTotalTiyn: String(money.buyerTotalTiyn), payoutTiyn: String(money.payoutTiyn), paymentProvider },
    meta: { requestId: input.requestId, offerId: input.offerId },
  });
  await documents().createContract(tx, dealId);
  const deal = await lockDeal(tx, dealId);
  await notifyBoth(tx, deal, "deal.offer.ready", { title: t.offerReady.title, body: t.offerReady.body(deal.number) });
  return { dealId };
};

async function signedDocument(tx: Tx, documentId: string, kind: "CONTRACT" | "ACCEPTANCE_ACT") {
  const doc = await tx.document.findUnique({ where: { id: documentId }, select: { dealId: true, kind: true, status: true } });
  if (!doc) return fail.notFound(e.notFound);
  if (doc.kind !== kind || doc.status !== "SIGNED") return fail.conflict(e.wrongDocument);
  return doc;
}

/**
 * Оферту подписали обе стороны: оферта заключена (signedAt) — открываются оплата и контакты сторон.
 * Статус остаётся CREATED (ТЗ п. 9). Повтор — без эффекта.
 */
export async function onContractSigned(tx: Tx, documentId: string): Promise<void> {
  const doc = await signedDocument(tx, documentId, "CONTRACT");
  const deal = await lockDeal(tx, doc.dealId);
  if (deal.signedAt || deal.status !== "CREATED") return;
  const signedAt = new Date();
  const result = await tx.deal.updateMany({ where: { id: deal.id, status: "CREATED", signedAt: null }, data: { signedAt } });
  if (result.count !== 1) return;
  await recordAudit(tx, { actor: SYSTEM_ACTOR, action: "deal.signed", entity: { type: "deal", id: deal.id }, scope: scopeOf(deal.id), after: { signedAt: signedAt.toISOString() }, meta: { documentId } });
  await requests().onContractSigned(tx, deal.id);
  await notifyBoth(tx, deal, "deal.signed", {
    CLIENT: { title: t.signed.CLIENT.title, body: t.signed.CLIENT.body(deal.number) },
    EXECUTOR: { title: t.signed.EXECUTOR.title, body: t.signed.EXECUTOR.body(deal.number) },
  });
}

/**
 * Покупатель подписал акт приёмки: READY → ACCEPTED и распоряжение о выплате (RELEASE + SPLIT_MASTER + SPLIT_PLATFORM,
 * основание — акт). Исполнение — задачей payments.executeDeal (вызов идёт внутри транзакции documents);
 * экран может ускорить его processDealMoney после подписи. Повтор по уже принятой сделке — без эффекта.
 */
export async function onActSigned(tx: Tx, documentId: string): Promise<void> {
  const doc = await signedDocument(tx, documentId, "ACCEPTANCE_ACT");
  const deal = await lockDeal(tx, doc.dealId);
  if (deal.status !== "READY") return;
  await moveDeal(tx, deal, { to: "ACCEPTED", who: "SYSTEM", actor: SYSTEM_ACTOR, action: "deal.accepted", data: { acceptedAt: new Date() }, meta: { documentId } });
  await requestPayout(tx, deal, { basisDocumentId: documentId });
  await notifyBoth(tx, deal, "deal.accepted", { title: t.accepted.title, body: t.accepted.body(deal.number) });
}

export const onDocumentSigned: OnDocumentSigned = async (tx, documentId) => {
  const doc = await tx.document.findUnique({ where: { id: documentId }, select: { kind: true } });
  if (doc?.kind === "CONTRACT") return onContractSigned(tx, documentId);
  if (doc?.kind === "ACCEPTANCE_ACT") return onActSigned(tx, documentId);
};

// ─── оплата ──────────────────────────────────────────────────────────────────

export type PayResult = { transactionId: string; status: MoneyTransactionStatus; redirectUrl: string | null };

/**
 * Покупатель оплачивает: HOLD buyerTotal через провайдера сделки. mock подтверждает сразу (→ PAID_HOLD),
 * manual — PENDING до подтверждения оператором. Двойной клик и параллельный запрос — одна и та же операция:
 * пока попытка ждёт банк или прошла, новая не создаётся; отклонённая — следующая попытка.
 *
 * До списания — согласия обеих сторон на передачу данных банку-партнёру к этой сделке (identity HasConsents, вне
 * транзакции): не хватает — CONFLICT BANK_CONSENT_MISSING, журнал денег не трогается. Сначала — что человек покупатель
 * этой сделки (чужая — «не найдено»): отказ по согласиям не выдаёт, что сделка существует.
 *
 * `seedWithoutBankConsent` — только демо-сид (src/demo/deals.ts) и только по тестовой сделке (isDemo): сид действует без
 * сессий сторон, а GrantConsent требует сессию (TODO Task 15: согласия демо-сделок — через сид identity).
 */
export async function payForDeal(user: CurrentUser, raw: { dealId: string }, opts: { seedWithoutBankConsent?: true } = {}): Promise<PayResult> {
  const { dealId } = parseInput(dealRefSchema, raw);
  const parties = await dealParties(dealId);
  requireParty(user, parties, "CLIENT");
  if (!opts.seedWithoutBankConsent) await requireBankConsents(dealId, parties);
  else if (!parties.isDemo) fail.forbidden();
  const hold = await transaction(async (tx) => {
    const deal = await lockDeal(tx, dealId);
    requireParty(user, deal, "CLIENT");
    if (contextOf(deal).openDispute) return refuse("disputeOpen");
    // Второй клик, пришедший после того, как первый уже довёл сделку до PAID_HOLD, — та же операция, не ошибка.
    const paidAlready = deal.status === "PAID_HOLD" && deal.money.hold === "SUCCEEDED";
    if (deal.status !== "CREATED" && !paidAlready) return fail.conflict(e.notAllowedNow);
    if (!deal.signedAt) return refuse("notSigned");
    if (deal.money.hold === "PENDING" || deal.money.hold === "SUCCEEDED") {
      return tx.moneyTransaction.findFirstOrThrow({ where: { dealId, type: "HOLD" }, orderBy: { seq: "desc" } });
    }
    const created = await requestHold(tx, deal, user.id);
    await recordAudit(tx, { actor: actorOf(user), action: "deal.payment.requested", entity: { type: "deal", id: dealId }, scope: scopeOf(dealId), after: { idempotencyKey: created.idempotencyKey } });
    return created;
  });
  const result = (await processDealMoney(dealId)).get(hold.id);
  const now = await db.moneyTransaction.findUniqueOrThrow({ where: { id: hold.id }, select: { status: true } });
  return { transactionId: hold.id, status: now.status, redirectUrl: result?.status === "PENDING" ? (result.redirectUrl ?? null) : null };
}

// ─── работа и сдача ──────────────────────────────────────────────────────────

export async function startWork(user: CurrentUser, raw: { dealId: string }): Promise<void> {
  const { dealId } = parseInput(dealRefSchema, raw);
  await transaction(async (tx) => {
    const deal = await lockDeal(tx, dealId);
    requireParty(user, deal, "EXECUTOR");
    await moveDeal(tx, deal, { to: "IN_PROGRESS", who: "EXECUTOR", actor: actorOf(user), action: "deal.started", data: { startedAt: new Date() } });
    await notifyParty(tx, deal, "CLIENT", "deal.started", { title: t.started.title, body: t.started.body(deal.number) });
  });
}

export type ReadyResult = GpsCheck & { radiusM: number };

/**
 * Мастер сдаёт работу (ТЗ п. 7): фото результата обязательно (≥ 1, назначение DELIVERY); GPS — мягкая проверка:
 * дальше READY_GPS_RADIUS_M — предупреждение, не запрет; нет координат — сдача разрешена, расстояние null.
 * Координаты, точность, расстояние и «в радиусе» сохраняются в сделке и попадают в акт приёмки.
 */
export async function submitReady(user: CurrentUser, raw: { dealId: string; photoIds: string[]; lat?: number; lng?: number; accuracyM?: number }): Promise<ReadyResult> {
  const input = parseInput(submitReadySchema, raw);
  const radiusM = env().READY_GPS_RADIUS_M;
  return transaction(async (tx) => {
    const deal = await lockDeal(tx, input.dealId);
    requireParty(user, deal, "EXECUTOR");
    const address = await tx.request.findUniqueOrThrow({ where: { id: deal.requestId }, select: { addressLat: true, addressLng: true } });
    const target = address.addressLat !== null && address.addressLng !== null ? { lat: address.addressLat, lng: address.addressLng } : null;
    const point = input.lat !== undefined && input.lng !== undefined ? { lat: input.lat, lng: input.lng } : null;
    const gps = checkGps(target, point, radiusM);
    await moveDeal(tx, deal, {
      to: "READY",
      who: "EXECUTOR",
      actor: actorOf(user),
      action: "deal.ready",
      data: { readyAt: new Date(), readyLat: point?.lat ?? null, readyLng: point?.lng ?? null, readyAccuracyM: point ? (input.accuracyM ?? null) : null, readyDistanceM: gps.distanceM, readyWithinRadius: gps.withinRadius },
      meta: { photos: input.photoIds.length, distanceM: gps.distanceM, withinRadius: gps.withinRadius, radiusM },
    });
    await attachOwnFiles(tx, { fileIds: input.photoIds, uploadedById: user.id, owner: { dealId: deal.id } });
    await documents().createAcceptanceAct(tx, deal.id);
    await notifyParty(tx, deal, "CLIENT", "deal.ready", { title: t.ready.title, body: t.ready.body(deal.number) });
    return { ...gps, radiusM };
  });
}

/** «Ход работ» (бывшие этапы): необязательный фото-отчёт мастера в ленте сделки — без денег и актов. */
export async function addProgressReport(user: CurrentUser, raw: { dealId: string; title?: string; text: string; photoIds?: string[] }): Promise<{ reportId: string }> {
  const input = parseInput(progressReportSchema, raw);
  return transaction(async (tx) => {
    const deal = await lockDeal(tx, input.dealId);
    requireParty(user, deal, "EXECUTOR");
    if (deal.status !== "IN_PROGRESS" && deal.status !== "READY") return fail.conflict(e.progressNotNow);
    const report = await tx.progressReport.create({
      data: { dealId: deal.id, authorId: user.id, title: await partyText(tx, deal, "EXECUTOR", input.title), text: await partyText(tx, deal, "EXECUTOR", input.text) },
      select: { id: true },
    });
    await attachOwnFiles(tx, { fileIds: input.photoIds, uploadedById: user.id, owner: { progressReportId: report.id } });
    await recordAudit(tx, { actor: actorOf(user), action: "deal.progress.reported", entity: { type: "progressReport", id: report.id }, scope: scopeOf(deal.id), after: { photos: input.photoIds.length } });
    await notifyParty(tx, deal, "CLIENT", "deal.progress", { title: t.progress.title, body: t.progress.body(deal.number) });
    return { reportId: report.id };
  });
}

// ─── отмена ──────────────────────────────────────────────────────────────────

export type CancelResult = { status: "CANCELLED" | "REFUND_REQUESTED" };

/**
 * Отмена (ADR-009 раздел 2): CREATED — любая сторона, сразу CANCELLED (если оплата не в обработке);
 * PAID_HOLD — только покупатель: REFUND всего оплаченного, REFUNDED — по подтверждению банка;
 * после начала работ — только через спор. Порт requests отменяет заявку: в CREATED — в той же транзакции,
 * после оплаты — когда банк подтвердил возврат (onMoneySettled → REFUNDED).
 */
export async function cancelDeal(user: CurrentUser, raw: { dealId: string; reason?: string }): Promise<CancelResult> {
  const input = parseInput(cancelDealSchema, raw);
  const result = await transaction(async (tx): Promise<CancelResult> => {
    const deal = await lockDeal(tx, input.dealId);
    const who = requireRole(user, deal);
    if (who === "OPERATOR") return fail.forbidden(e.notYourAction);
    const meta = { reason: await partyText(tx, deal, who, input.reason) };
    if (deal.status === "CREATED") {
      await moveDeal(tx, deal, { to: "CANCELLED", who, actor: actorOf(user), action: "deal.cancelled", data: { cancelledAt: new Date() }, meta });
      await requests().onDealCancelled(tx, deal.id);
      await notifyParty(tx, deal, otherParty(who), "deal.cancelled", { title: t.cancelled.title, body: t.cancelled.body(deal.number) });
      return { status: "CANCELLED" };
    }
    if (deal.status !== "PAID_HOLD") return fail.conflict(e.cancelOnlyDispute);
    if (who !== "CLIENT") return fail.forbidden(e.cancelOnlyClient);
    const ctx = contextOf(deal);
    if (ctx.openDispute) return refuse("disputeOpen");
    if (ctx.money.exitRequested || !deal.money.heldEntry) return refuse("moneyLeaving");
    await requestRefund(tx, deal, deal.money.heldEntry.amountTiyn, { actorId: user.id });
    await recordAudit(tx, { actor: actorOf(user), action: "deal.cancel.requested", entity: { type: "deal", id: deal.id }, scope: scopeOf(deal.id), meta });
    await notifyParty(tx, deal, "EXECUTOR", "deal.cancel.requested", { title: t.refundRequested.title, body: t.refundRequested.body(deal.number) });
    return { status: "REFUND_REQUESTED" };
  });
  if (result.status === "REFUND_REQUESTED") await processDealMoney(input.dealId);
  return result;
}

// ─── отзыв (флаг reviews) ────────────────────────────────────────────────────

/** Отзыв оставляет покупатель этой сделки (не сам себе) и только после выплаты. */
function assertCanReview(user: CurrentUser, deal: DealState): void {
  if (requireRole(user, deal) !== "CLIENT") fail.forbidden(e.onlyClientReviews);
  if (deal.executor.userId === user.id) fail.forbidden(e.selfReview);
  if (deal.status !== "SPLIT_PAYOUT") fail.conflict(e.reviewOnlyCompleted);
}

export async function leaveReview(user: CurrentUser, raw: { dealId: string; rating: number; text?: string; portfolioConsent?: boolean }): Promise<void> {
  if (!isEnabled("reviews")) return fail.forbidden(e.reviewsOff);
  const input = parseInput(reviewSchema, raw);
  await transaction(async (tx) => {
    const deal = await lockDeal(tx, input.dealId);
    assertCanReview(user, deal);
    const created = await tx.review.createMany({
      data: [{ dealId: deal.id, executorId: deal.executorId, authorId: user.id, rating: input.rating, text: input.text }],
      skipDuplicates: true,
    });
    if (created.count === 0) return fail.conflict(e.reviewExists);
    await recordAudit(tx, { actor: actorOf(user), action: "review.created", entity: { type: "deal", id: deal.id }, scope: scopeOf(deal.id), after: { rating: input.rating } });
    await recalculateRating(tx, deal.executorId);
    // Согласие на показ фото — в той же транзакции: отзыв без согласия или согласие без отзыва не останутся наполовину.
    if (input.portfolioConsent) await applyPortfolioConsent(tx, user, deal.id, true);
    await notifyParty(tx, deal, "EXECUTOR", "deal.review", { title: t.review.title, body: t.review.body(input.rating) });
  });
}
