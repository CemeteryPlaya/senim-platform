import "server-only";
import { z } from "zod";
import { recordAudit, SYSTEM } from "@/modules/audit";
import { sanitizeExecutorText } from "@/modules/companies";
import { createDeal } from "@/modules/deal-core";
import { recordClientIdentity, type CurrentUser } from "@/modules/identity";
import { notify, notifyTemplate } from "@/modules/notifications";
import { ru } from "@/i18n/ru";
import { db, transaction, type Db } from "@/platform/db";
import { expectOneUpdated, fail } from "@/platform/errors";
import { enqueueJob, type JobHandler } from "@/platform/jobs";
import { STAGE_TEMPLATES, type StageTemplateKey } from "@/verticals/furniture";
import { auditByUser, links, loadExecutor, loadOwnRequest, requestScope, requestTitle, requireClient } from "./access";
import { MEASUREMENT_TRANSITIONS, OFFER_TRANSITIONS, REQUEST_TRANSITIONS, transition } from "./transitions";

const e = ru.requests.errors;
const v = ru.requests.validation;
const n = ru.requests.notify;

const withRequest = { request: { include: { furnitureType: { select: { name: true } } } } } as const;

export const JOB_MEASUREMENT_REMINDER = "requests.measurementReminder";
/** За сколько до выезда напомнить обеим сторонам (SMS — шаблон measurement.reminder). */
const REMINDER_LEAD_MS = 24 * 60 * 60 * 1000;

/** OFFER_CHOSEN → MEASURING: исполнитель выбранного отклика назначает выезд замерщика. */
export async function scheduleMeasurement(user: CurrentUser, input: { offerId: string; scheduledAt: Date }): Promise<{ measurementId: string }> {
  return transaction(async (tx) => {
    const executor = await loadExecutor(tx, user);
    const offer = await tx.offer.findFirst({ where: { id: input.offerId, executorId: executor.id }, include: withRequest });
    if (!offer) return fail.notFound(e.offerNotFound);
    if (input.scheduledAt.getTime() <= Date.now()) fail.validation(v.futureDate);
    const r = offer.request;
    const to = transition(REQUEST_TRANSITIONS, "scheduleMeasurement", r.status, "EXECUTOR");
    if (offer.status !== "ACCEPTED") fail.conflict();

    expectOneUpdated(await tx.request.updateMany({ where: { id: r.id, status: r.status }, data: { status: to } }));
    const m = await tx.measurement.create({ data: { offerId: offer.id, requestId: r.id, scheduledAt: input.scheduledAt } });
    await auditByUser(tx, user, r.id, {
      action: "measurement.scheduled",
      entity: { type: "measurement", id: m.id },
      before: { request: r.status },
      after: { status: m.status, scheduledAt: m.scheduledAt.toISOString(), request: to },
    });
    await enqueueJob(tx, {
      kind: JOB_MEASUREMENT_REMINDER,
      payload: { measurementId: m.id },
      runAt: new Date(Math.max(Date.now(), m.scheduledAt.getTime() - REMINDER_LEAD_MS)),
      dedupeKey: `measurement-reminder:${m.id}`,
    });
    await notify(tx, {
      userId: r.clientId,
      kind: "measurement.scheduled",
      title: n.measurementScheduled.title,
      body: n.measurementScheduled.body(requestTitle(r)),
      link: links.client(r.id),
    });
    return { measurementId: m.id };
  });
}

/**
 * Задача напоминания о замере: обеим сторонам, если замер всё ещё назначен (не отменён, не перенесён в итог).
 * Повтор безопасен: одна задача на замер (dedupeKey), а выполненный или отменённый замер не напоминается.
 */
export const remindMeasurement: JobHandler = async (payload, ctx) => {
  const { measurementId } = z.object({ measurementId: z.string().min(1) }).parse(payload);
  await transaction(async (tx) => {
    const m = await tx.measurement.findUnique({
      where: { id: measurementId },
      include: { ...withRequest, offer: { select: { executor: { select: { userId: true } } } } },
    });
    if (!m || m.status !== "SCHEDULED" || m.request.status !== "MEASURING") {
      ctx.log.info("measurement.reminder.skipped", { measurementId });
      return;
    }
    const common = { requestId: m.requestId, requestTitle: requestTitle(m.request), at: m.scheduledAt };
    await notifyTemplate(tx, m.request.clientId, "measurement.reminder", { ...common, audience: "client" });
    await notifyTemplate(tx, m.offer.executor.userId, "measurement.reminder", { ...common, audience: "executor" });
  });
};

/** SCHEDULED → DONE: исполнитель вносит итоговую цену после замера. */
export async function completeMeasurement(user: CurrentUser, input: { measurementId: string; finalPrice: number; result: string }): Promise<void> {
  await transaction(async (tx) => {
    const executor = await loadExecutor(tx, user);
    const m = await tx.measurement.findFirst({ where: { id: input.measurementId, offer: { executorId: executor.id } }, include: withRequest });
    if (!m) return fail.notFound(e.measurementNotFound);
    const to = transition(MEASUREMENT_TRANSITIONS, "complete", m.status, "EXECUTOR");
    if (m.request.status !== "MEASURING") fail.conflict();

    const result = input.result ? (await sanitizeExecutorText(tx, executor.id, input.result)).text : null;
    const data = { status: to, finalPrice: input.finalPrice, result, doneAt: new Date() };
    expectOneUpdated(await tx.measurement.updateMany({ where: { id: m.id, status: m.status }, data }));
    await auditByUser(tx, user, m.requestId, {
      action: "measurement.done",
      entity: { type: "measurement", id: m.id },
      before: { status: m.status },
      after: { status: to, finalPrice: input.finalPrice },
    });
    await notify(tx, {
      userId: m.request.clientId,
      kind: "measurement.done",
      title: n.measurementDone.title,
      body: n.measurementDone.body(requestTitle(m.request)),
      link: links.client(m.requestId),
    });
  });
}

/**
 * Замер без сделки (любая сторона): замер NO_DEAL, отклик DECLINED, заявка снова OPEN.
 * Плата за выезд — только запись `feeAccrued` по условиям отклика: платформа деньги не принимает.
 */
export async function measurementNoDeal(user: CurrentUser, input: { measurementId: string; result: string }): Promise<void> {
  if (user.role !== "CLIENT" && user.role !== "EXECUTOR") fail.forbidden();
  const who = user.role;
  await transaction(async (tx) => {
    const executorId = who === "EXECUTOR" ? (await loadExecutor(tx, user)).id : null;
    const m = await tx.measurement.findFirst({
      where: { id: input.measurementId, ...(executorId ? { offer: { executorId } } : { request: { clientId: user.id } }) },
      include: { ...withRequest, offer: { include: { executor: { select: { userId: true } } } } },
    });
    if (!m) return fail.notFound(e.measurementNotFound);
    const measurementTo = transition(MEASUREMENT_TRANSITIONS, "noDeal", m.status, who);
    const requestTo = transition(REQUEST_TRANSITIONS, "measurementNoDeal", m.request.status, who);
    const offerTo = transition(OFFER_TRANSITIONS, "noDeal", m.offer.status, who);
    const feeAccrued = m.offer.measurementTerms === "FEE_IF_NO_DEAL" ? m.offer.measurementFee : null;

    expectOneUpdated(
      await tx.measurement.updateMany({
        where: { id: m.id, status: m.status },
        data: { status: measurementTo, feeAccrued, result: input.result || m.result, doneAt: m.doneAt ?? new Date() },
      }),
    );
    expectOneUpdated(await tx.offer.updateMany({ where: { id: m.offerId, status: m.offer.status }, data: { status: offerTo } }));
    expectOneUpdated(await tx.request.updateMany({ where: { id: m.requestId, status: m.request.status }, data: { status: requestTo } }));

    await auditByUser(tx, user, m.requestId, {
      action: "measurement.no_deal",
      entity: { type: "measurement", id: m.id },
      before: { status: m.status },
      after: { status: measurementTo, feeAccrued },
      meta: { feePolicy: "direct" }, // плата за выезд — напрямую исполнителю, платформа только фиксирует
    });
    await auditByUser(tx, user, m.requestId, {
      action: "request.reopened",
      entity: { type: "request", id: m.requestId },
      before: { status: m.request.status },
      after: { status: requestTo },
      meta: { offerId: m.offerId },
    });
    const other = who === "CLIENT" ? { userId: m.offer.executor.userId, link: links.executor(m.requestId) } : { userId: m.request.clientId, link: links.client(m.requestId) };
    await notify(tx, {
      ...other,
      kind: "measurement.no_deal",
      title: n.measurementNoDeal.title,
      body: n.measurementNoDeal.body(requestTitle(m.request)),
    });
  });
}

/**
 * MEASURING → CONTRACTING: заказчик согласен с итоговой ценой замера и порядком оплаты.
 * Сделку создаёт deal-core в той же транзакции.
 */
export async function agreeToContract(
  user: CurrentUser,
  input: { requestId: string; template: StageTemplateKey; identity?: { fullName: string; iin: string } },
): Promise<{ dealId: string }> {
  requireClient(user);
  return transaction(async (tx) => {
    const r = await loadOwnRequest(tx, user, input.requestId);
    const to = transition(REQUEST_TRANSITIONS, "agreeToContract", r.status, "CLIENT");
    const m = await tx.measurement.findFirst({ where: { requestId: r.id, status: "DONE", offer: { status: "ACCEPTED" } }, include: { offer: true } });
    if (!m || m.finalPrice === null) return fail.conflict(e.noMeasurementResult);
    // Сторона договора: без ФИО и ИИН договор не составить и не подписать ЭЦП. После проверок шага:
    // ответ «ИИН занят» — только на настоящем шаге договора, а не любому заказчику с любой заявкой.
    await recordClientIdentity(tx, user, input.identity);

    expectOneUpdated(await tx.request.updateMany({ where: { id: r.id, status: r.status }, data: { status: to } }));
    const title = requestTitle(r);
    const { dealId } = await createDeal(tx, {
      requestId: r.id,
      offerId: m.offerId,
      clientId: user.id,
      executorId: m.offer.executorId,
      title,
      totalAmount: m.finalPrice,
      template: STAGE_TEMPLATES[input.template],
    });
    await auditByUser(tx, user, r.id, {
      action: "request.contracting",
      entity: { type: "request", id: r.id },
      before: { status: r.status },
      after: { status: to, dealId, totalAmount: m.finalPrice, template: input.template },
    });
    const executor = await tx.executorProfile.findUniqueOrThrow({ where: { id: m.offer.executorId }, select: { userId: true } });
    await notify(tx, { userId: executor.userId, kind: "request.contracting", title: n.contracting.title, body: n.contracting.body(title), link: `/deals/${dealId}` });
    return { dealId };
  });
}

/**
 * CONTRACTING → CLOSED: договор подписан обеими сторонами. Вызывает deal-core
 * в транзакции подписи (см. отчёт: «Нужно от интегратора»).
 */
export async function onContractSigned(tx: Db, requestId: string): Promise<void> {
  const r = await tx.request.findUnique({ where: { id: requestId }, select: { id: true, status: true } });
  if (!r) return fail.notFound(e.notFound);
  const to = transition(REQUEST_TRANSITIONS, "contractSigned", r.status, "SYSTEM");
  expectOneUpdated(await tx.request.updateMany({ where: { id: r.id, status: r.status }, data: { status: to, closedAt: new Date() } }));
  await recordAudit(tx, {
    actor: SYSTEM("requests"),
    action: "request.closed",
    entity: { type: "request", id: r.id },
    scope: requestScope(r.id),
    before: { status: r.status },
    after: { status: to },
  });
}

/**
 * Хук подписи документа сделки (documents.completeSigning → onFullySigned): когда договор
 * подписан обеими сторонами, заявка CONTRACTING → CLOSED. Акты и заявки в другом статусе не трогает.
 */
export async function onDealDocumentSigned(tx: Db, documentId: string): Promise<void> {
  const doc = await tx.document.findUnique({
    where: { id: documentId },
    select: { kind: true, deal: { select: { requestId: true, request: { select: { status: true } } } } },
  });
  if (doc?.kind !== "CONTRACT" || doc.deal.request.status !== "CONTRACTING") return;
  await onContractSigned(tx, doc.deal.requestId);
}

// ─── чтение: исполнитель ─────────────────────────────────────────────────────

/** Замеры исполнителя: ближайшие сверху. Адрес — пока отклик выбран. */
export async function listMyMeasurements(user: CurrentUser) {
  const executor = await loadExecutor(db, user);
  const rows = await db.measurement.findMany({
    where: { offer: { executorId: executor.id } },
    orderBy: { scheduledAt: "desc" },
    include: { ...withRequest, offer: { select: { status: true, price: true, measurementTerms: true, measurementFee: true } } },
  });
  return rows.map((m) => ({
    id: m.id,
    status: m.status,
    scheduledAt: m.scheduledAt,
    finalPrice: m.finalPrice,
    feeAccrued: m.feeAccrued,
    result: m.result,
    offer: m.offer,
    request: {
      id: m.requestId,
      number: m.request.number,
      title: requestTitle(m.request),
      status: m.request.status,
      address: m.offer.status === "ACCEPTED" ? m.request.address : null,
    },
  }));
}
export type MeasurementListItem = Awaited<ReturnType<typeof listMyMeasurements>>[number];

/** Выбранные отклики, по которым замер ещё не назначен. */
export async function listAwaitingMeasurement(user: CurrentUser) {
  const executor = await loadExecutor(db, user);
  const rows = await db.offer.findMany({
    where: { executorId: executor.id, status: "ACCEPTED", request: { status: "OFFER_CHOSEN" } },
    orderBy: { updatedAt: "desc" },
    include: withRequest,
  });
  return rows.map((o) => ({ offerId: o.id, requestId: o.requestId, number: o.request.number, title: requestTitle(o.request), address: o.request.address }));
}
