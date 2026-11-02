import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { executorDisplayOf, findLikeablePortfolioItem } from "@/modules/companies";
import { attachFiles } from "@/modules/files";
import type { CurrentUser } from "@/modules/identity";
import { notify } from "@/modules/notifications";
import { ru } from "@/i18n/ru";
import { db, transaction, type Tx } from "@/platform/db";
import { expectOneUpdated, fail } from "@/platform/errors";
import { suggestSegment } from "@/verticals/furniture";
import { auditByUser, links, loadOwnRequest, requestTitle, requireClient, type RequestWithType } from "./access";
import { roomPhotos } from "./adapters";
import { announceToExecutors, executorRecipients } from "./announce";
import { newRequestPath } from "./flow-setting";
import { flowRules, pathOf, selfMeasureComplete, TZ_PATH } from "./flows";
import { notifyOperatorsSiteMeasure } from "./site-measurements";
import { preContractView } from "./pre-contract";
import {
  applyStep,
  parseDetails,
  screenIndex,
  segmentInputOf,
  WIZARD_SCREENS,
  type SaveDraftInput,
  type StepInput,
} from "./schema";
import { MEASUREMENT_TRANSITIONS, OFFER_TRANSITIONS, REQUEST_TRANSITIONS, transition } from "./transitions";

const e = ru.requests.errors;
const n = ru.requests.notify;

/** Поля заявки, которые меняет шаг мастера (кроме details). */
async function typeFields(tx: Tx, step: { furnitureTypeId: string | null; customType: string | null }) {
  if (step.furnitureTypeId) {
    const known = await tx.furnitureType.findFirst({ where: { id: step.furnitureTypeId, active: true }, select: { id: true } });
    if (!known) fail.validation(e.unknownType);
  }
  return { furnitureTypeId: step.furnitureTypeId, customType: step.customType || null };
}

async function fieldsOf(tx: Tx, step: StepInput): Promise<Prisma.RequestUpdateManyMutationInput & { furnitureTypeId?: string | null }> {
  switch (step.screen) {
    case "start":
      return { ...(await typeFields(tx, step)), style: step.style };
    case "type":
      return typeFields(tx, step);
    case "style":
      return { style: step.style };
    case "segment":
      return { segment: step.segment };
    case "place":
      return {
        city: step.city,
        address: step.address,
        desiredDate: step.desiredDate ? new Date(`${step.desiredDate}T00:00:00Z`) : null,
        // Точка адреса — обе координаты или ни одной (CHECK в БД); без точки адрес сохраняется как есть.
        addressLat: step.location?.lat ?? null,
        addressLng: step.location?.lng ?? null,
      };
    case "room":
    case "size":
    case "materials":
    case "send":
      return {};
  }
}

/**
 * Фото помещения: к заявке прикреплены ровно выбранные файлы. Убранные открепляются,
 * новые прикрепляет files.attachFiles (только свои, ещё не прикреплённые, назначения REQUEST_ROOM).
 */
async function linkRoomPhotos(tx: Tx, user: CurrentUser, requestId: string, fileIds: string[]) {
  await tx.storedFile.updateMany({ where: { requestId, purpose: "REQUEST_ROOM", id: { notIn: fileIds } }, data: { requestId: null } });
  const attached = new Set(
    (await tx.storedFile.findMany({ where: { requestId, purpose: "REQUEST_ROOM" }, select: { id: true } })).map((f) => f.id),
  );
  const fresh = fileIds.filter((id) => !attached.has(id));
  if (fresh.length > 0) await attachFiles(tx, { fileIds: fresh, uploadedById: user.id, owner: { requestId } });
}

async function createDraft(tx: Tx, user: CurrentUser, like: string | null | undefined): Promise<RequestWithType> {
  const item = like ? await findLikeablePortfolioItem(tx, like, user.id) : null;
  if (like && !item) fail.notFound(e.portfolioNotFound);
  const r = await tx.request.create({
    data: {
      clientId: user.id,
      mode: item ? "DIRECT" : "TENDER",
      targetExecutorId: item?.executorId,
      portfolioItemId: item?.id,
      style: item?.style,
    },
    include: { furnitureType: { select: { name: true } } },
  });
  await auditByUser(tx, user, r.id, {
    action: "request.created",
    entity: { type: "request", id: r.id },
    after: { status: "DRAFT", mode: r.mode },
  });
  return r;
}

/**
 * Сохраняет экран мастера. Первый экран без requestId создаёт черновик (с `like` — прямой запрос).
 * Прогресс мастера не откатывается, если заказчик вернулся на ранний шаг.
 */
export async function saveDraftStep(user: CurrentUser, input: SaveDraftInput): Promise<{ requestId: string; wizardStep: number }> {
  requireClient(user);
  const { step } = input;
  return transaction(async (tx) => {
    let r: RequestWithType;
    if (input.requestId) {
      r = await loadOwnRequest(tx, user, input.requestId);
    } else {
      if (step.screen !== "start" && step.screen !== "type") fail.validation(e.startFromFirst);
      r = await createDraft(tx, user, input.like);
    }
    if (r.status !== "DRAFT") fail.conflict(e.notDraft);

    const details = applyStep(parseDetails(r.details), step);
    const wizardStep = Math.max(r.wizardStep, screenIndex(step.screen) + 1);
    const updated = await tx.request.updateMany({
      where: { id: r.id, status: "DRAFT" },
      data: {
        ...(await fieldsOf(tx, step)),
        details,
        segmentSuggested: suggestSegment(segmentInputOf(details)).segment,
        wizardStep,
      },
    });
    expectOneUpdated(updated);
    if (step.screen === "room") await linkRoomPhotos(tx, user, r.id, step.photoFileIds);

    await auditByUser(tx, user, r.id, { action: "request.draft_saved", entity: { type: "request", id: r.id }, meta: { screen: step.screen, wizardStep } });
    return { requestId: r.id, wizardStep };
  });
}

/**
 * Отправка заявки: DRAFT → OPEN, тендер видят исполнители сегмента, прямой запрос — только выбранный исполнитель.
 * Путь заявки запоминается при отправке: по умолчанию — путь ТЗ (торг → оферта); при флаге preContractFlows —
 * сценарий до договора из настройки площадки (ADR-005). «Замерщик площадки»: DRAFT → PLATFORM_MEASURING.
 */
export async function publishRequest(user: CurrentUser, input: { requestId: string }): Promise<void> {
  await transaction(async (tx) => {
    const r = await loadOwnRequest(tx, user, input.requestId);
    const path = await newRequestPath(tx);
    const to = transition(REQUEST_TRANSITIONS, "publish", r.status, "CLIENT", path);
    if (r.wizardStep < WIZARD_SCREENS.length || !r.segment || !r.address || !(r.furnitureTypeId || r.customType)) {
      fail.validation(e.incomplete);
    }
    if (path !== TZ_PATH && flowRules(path).selfMeasure) {
      const photos = await tx.storedFile.count({ where: { requestId: r.id, purpose: "REQUEST_ROOM" } });
      if (!selfMeasureComplete(parseDetails(r.details), photos)) fail.validation(ru.requests.pre.errors.selfMeasureIncomplete);
    }
    // Прямой запрос недоступному исполнителю или себе — CONFLICT уже здесь, даже если заявка сначала ждёт замерщика.
    const recipients = await executorRecipients(tx, r);

    const preContractFlow = path === TZ_PATH ? null : path;
    expectOneUpdated(await tx.request.updateMany({ where: { id: r.id, status: r.status }, data: { status: to, preContractFlow, publishedAt: new Date() } }));
    await auditByUser(tx, user, r.id, {
      action: "request.published",
      entity: { type: "request", id: r.id },
      before: { status: r.status },
      after: { status: to, path },
      meta: { mode: r.mode, segment: r.segment, recipients: to === "OPEN" ? recipients.length : 0 },
    });
    if (to === "OPEN") await announceToExecutors(tx, r, recipients);
    else await notifyOperatorsSiteMeasure(tx, r);
  });
}

/**
 * Заказчик отменяет заявку до договора. Неотвеченные и выбранный отклики отклоняются; замер до выезда
 * отменяется, а после выезда фиксируется как «без сделки» с платой за выезд по условиям отклика (только запись).
 * Все переходы — по таблицам (transitions.ts); заявка меняется первой, поэтому двойной клик даст CONFLICT.
 */
export async function cancelRequest(user: CurrentUser, input: { requestId: string; reason?: string }): Promise<void> {
  requireClient(user);
  await transaction(async (tx) => {
    const r = await loadOwnRequest(tx, user, input.requestId);
    const to = transition(REQUEST_TRANSITIONS, "cancel", r.status, "CLIENT");
    expectOneUpdated(await tx.request.updateMany({ where: { id: r.id, status: r.status }, data: { status: to, closedAt: new Date() } }));

    const affected = await tx.offer.findMany({
      where: { requestId: r.id, status: { in: ["SENT", "ACCEPTED"] } },
      select: { id: true, status: true, measurementTerms: true, measurementFee: true, executor: { select: { userId: true } } },
    });
    await tx.offer.updateMany({ where: { requestId: r.id, status: "SENT" }, data: { status: transition(OFFER_TRANSITIONS, "decline", "SENT", "CLIENT") } });

    const accepted = affected.find((o) => o.status === "ACCEPTED");
    if (accepted) {
      const offerTo = transition(OFFER_TRANSITIONS, "requestCancelled", accepted.status, "CLIENT");
      expectOneUpdated(await tx.offer.updateMany({ where: { id: accepted.id, status: accepted.status }, data: { status: offerTo } }));
      await closeMeasurement(tx, accepted);
    }

    await auditByUser(tx, user, r.id, {
      action: "request.cancelled",
      entity: { type: "request", id: r.id },
      before: { status: r.status },
      after: { status: to },
      meta: { reason: input.reason ?? "" },
    });
    const title = requestTitle(r);
    for (const o of affected) {
      await notify(tx, { userId: o.executor.userId, kind: "request.cancelled", title: n.cancelled.title, body: n.cancelled.body(title), link: links.executor(r.id) });
    }
  });
}

/** Замер выбранного отклика при отмене заявки: до выезда — CANCELLED, после — NO_DEAL с платой за выезд (запись). */
async function closeMeasurement(tx: Tx, offer: { id: string; measurementTerms: string; measurementFee: number | null }) {
  const m = await tx.measurement.findFirst({ where: { offerId: offer.id, status: { in: ["SCHEDULED", "DONE"] } }, select: { id: true, status: true } });
  if (!m) return;
  const data =
    m.status === "SCHEDULED"
      ? { status: transition(MEASUREMENT_TRANSITIONS, "cancel", m.status, "CLIENT") }
      : { status: transition(MEASUREMENT_TRANSITIONS, "noDeal", m.status, "CLIENT"), feeAccrued: offer.measurementTerms === "FEE_IF_NO_DEAL" ? offer.measurementFee : null };
  expectOneUpdated(await tx.measurement.updateMany({ where: { id: m.id, status: m.status }, data }));
}

// ─── чтение для экранов заказчика ────────────────────────────────────────────

/** Черновик для мастера: сохранённые ответы и фото. */
export async function getDraft(user: CurrentUser, requestId: string) {
  const r = await loadOwnRequest(db, user, requestId);
  const photos = await db.storedFile.findMany({
    where: { requestId, purpose: "REQUEST_ROOM" },
    orderBy: { sortOrder: "asc" },
    select: { id: true, provider: true, storageKey: true },
  });
  const target = r.targetExecutorId
    ? await db.executorProfile.findUnique({ where: { id: r.targetExecutorId }, select: { publicNumber: true, segment: true } })
    : null;
  // Подпись исполнителя прямой заявки — по режиму «имя скрыто / показано» (companies, №6).
  const targetLabel = r.targetExecutorId ? (await executorDisplayOf(db, r.targetExecutorId)).label : null;
  return {
    id: r.id,
    number: r.number,
    status: r.status,
    mode: r.mode,
    furnitureTypeId: r.furnitureTypeId,
    customType: r.customType,
    style: r.style,
    details: parseDetails(r.details),
    segment: r.segment,
    segmentSuggested: r.segmentSuggested,
    city: r.city,
    address: r.address,
    location: r.addressLat !== null && r.addressLng !== null ? { lat: r.addressLat, lng: r.addressLng } : null,
    desiredDate: r.desiredDate,
    wishes: r.wishes,
    wizardStep: r.wizardStep,
    typeChosen: r.furnitureTypeId !== null || r.customType !== null,
    title: requestTitle(r),
    photos: await roomPhotos(photos),
    target,
    targetLabel,
  };
}
export type Draft = Awaited<ReturnType<typeof getDraft>>;

/** Работа из портфолио для «Хочу похожее»: тип и исполнитель без личных данных. */
/** Работа для «Хочу похожее» глазами заказчика: своя работа не найдётся (самосделка запрещена). */
export async function likeTarget(portfolioItemId: string, user: Pick<CurrentUser, "id">) {
  const item = await findLikeablePortfolioItem(db, portfolioItemId, user.id);
  if (!item) return fail.notFound(e.portfolioNotFound);
  const { label } = await executorDisplayOf(db, item.executorId);
  return { id: item.id, title: item.title, furnitureTypeId: item.furnitureTypeId, style: item.style, executor: { ...item.executor, label } };
}

/** «Мои заявки»: свои заявки с числом действующих откликов и обложкой — первым фото помещения. */
export async function listMyRequests(user: CurrentUser) {
  requireClient(user);
  const rows = await db.request.findMany({
    where: { clientId: user.id },
    orderBy: { updatedAt: "desc" },
    include: {
      furnitureType: { select: { name: true } },
      _count: { select: { offers: { where: { status: { not: "WITHDRAWN" } } } } },
      photos: {
        where: { purpose: "REQUEST_ROOM" },
        orderBy: { sortOrder: "asc" },
        take: 1,
        select: { id: true, provider: true, storageKey: true },
      },
    },
  });
  const covers = await roomPhotos(rows.flatMap((r) => r.photos));
  const coverOf = new Map(covers.map((c) => [c.id, c]));
  return rows.map((r) => ({
    cover: r.photos[0] ? (coverOf.get(r.photos[0].id) ?? null) : null,
    id: r.id,
    number: r.number,
    title: requestTitle(r),
    status: r.status,
    mode: r.mode,
    segment: r.segment,
    wizardStep: r.wizardStep,
    createdAt: r.createdAt,
    publishedAt: r.publishedAt,
    offersCount: r._count.offers,
  }));
}

/** Заявка заказчика для экрана откликов: статус, выбранный отклик, замер и сделка. */
export async function getClientRequest(user: CurrentUser, requestId: string) {
  const r = await loadOwnRequest(db, user, requestId);
  const [chosen, deal, offersCount] = await Promise.all([
    db.offer.findFirst({
      where: { requestId, status: "ACCEPTED" },
      include: { measurement: true, executor: { select: { publicNumber: true } } },
    }),
    db.deal.findUnique({ where: { requestId }, select: { id: true, number: true } }),
    db.offer.count({ where: { requestId, status: { not: "WITHDRAWN" } } }),
  ]);
  const m = chosen?.measurement ?? null;
  return {
    id: r.id,
    number: r.number,
    title: requestTitle(r),
    status: r.status,
    mode: r.mode,
    segment: r.segment,
    style: r.style,
    details: parseDetails(r.details),
    city: r.city,
    address: r.address,
    location: r.addressLat !== null && r.addressLng !== null ? { lat: r.addressLat, lng: r.addressLng } : null,
    desiredDate: r.desiredDate,
    wishes: r.wishes,
    wizardStep: r.wizardStep,
    publishedAt: r.publishedAt,
    path: pathOf(r),
    offersCount,
    chosen: chosen && {
      id: chosen.id,
      executorNumber: chosen.executor.publicNumber,
      executorLabelGen: (await executorDisplayOf(db, chosen.executorId)).labelGen,
      priceTiyn: chosen.priceTiyn,
      measurementTerms: chosen.measurementTerms,
      measurementFee: chosen.measurementFee,
    },
    measurement: m && { id: m.id, status: m.status, scheduledAt: m.scheduledAt, finalPrice: m.finalPrice, result: m.result },
    deal,
    pre: await preContractView(db, r, chosen),
  };
}
export type ClientRequest = Awaited<ReturnType<typeof getClientRequest>>;
