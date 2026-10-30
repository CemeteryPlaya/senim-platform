import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { attachFiles } from "@/modules/files";
import type { CurrentUser } from "@/modules/identity";
import { notify } from "@/modules/notifications";
import { ru } from "@/i18n/ru";
import { db, transaction, type Tx } from "@/platform/db";
import { expectOneUpdated, fail } from "@/platform/errors";
import { suggestSegment } from "@/verticals/furniture";
import { auditByUser, links, loadOwnRequest, requestTitle, requireClient, type RequestWithType } from "./access";
import { roomPhotos } from "./adapters";
import {
  applyStep,
  parseDetails,
  screenIndex,
  segmentInputOf,
  WIZARD_SCREENS,
  type SaveDraftInput,
  type StepInput,
} from "./schema";
import { REQUEST_TRANSITIONS, transition } from "./transitions";

const e = ru.requests.errors;
const n = ru.requests.notify;

/** Поля заявки, которые меняет шаг мастера (кроме details). */
async function fieldsOf(tx: Tx, step: StepInput): Promise<Prisma.RequestUpdateManyMutationInput & { furnitureTypeId?: string | null }> {
  switch (step.screen) {
    case "type": {
      if (step.furnitureTypeId) {
        const known = await tx.furnitureType.findFirst({ where: { id: step.furnitureTypeId, active: true }, select: { id: true } });
        if (!known) fail.validation(e.unknownType);
      }
      return { furnitureTypeId: step.furnitureTypeId, customType: step.customType || null };
    }
    case "style":
      return { style: step.style };
    case "send":
      return {
        segment: step.segment,
        city: step.city,
        address: step.address,
        desiredDate: step.desiredDate ? new Date(`${step.desiredDate}T00:00:00Z`) : null,
        wishes: step.wishes,
      };
    case "room":
    case "size":
    case "materials":
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
  const item = like
    ? await tx.portfolioItem.findFirst({ where: { id: like, published: true }, select: { id: true, executorId: true, style: true } })
    : null;
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
      if (step.screen !== "type") fail.validation(e.startFromFirst);
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

/** DRAFT → OPEN. Тендер видят исполнители сегмента, прямой запрос — только выбранный исполнитель. */
export async function publishRequest(user: CurrentUser, input: { requestId: string }): Promise<void> {
  await transaction(async (tx) => {
    const r = await loadOwnRequest(tx, user, input.requestId);
    const to = transition(REQUEST_TRANSITIONS, "publish", r.status, "CLIENT");
    if (r.wizardStep < WIZARD_SCREENS.length || !r.segment || !r.address || !(r.furnitureTypeId || r.customType)) {
      fail.validation(e.incomplete);
    }

    let recipients: string[];
    if (r.mode === "DIRECT") {
      const target = r.targetExecutorId
        ? await tx.executorProfile.findFirst({ where: { id: r.targetExecutorId, status: "APPROVED" }, select: { userId: true } })
        : null;
      if (!target) return fail.conflict(e.targetUnavailable);
      recipients = [target.userId];
    } else {
      const executors = await tx.executorProfile.findMany({ where: { status: "APPROVED", segment: r.segment }, select: { userId: true } });
      recipients = executors.map((x) => x.userId);
    }

    expectOneUpdated(await tx.request.updateMany({ where: { id: r.id, status: r.status }, data: { status: to, publishedAt: new Date() } }));
    await auditByUser(tx, user, r.id, {
      action: "request.published",
      entity: { type: "request", id: r.id },
      before: { status: r.status },
      after: { status: to },
      meta: { mode: r.mode, segment: r.segment, recipients: recipients.length },
    });

    const title = requestTitle(r);
    const text = r.mode === "DIRECT" ? n.directRequest : n.newRequest;
    for (const userId of recipients) {
      await notify(tx, { userId, kind: "request.new", title: text.title, body: text.body(title), link: links.executor(r.id) });
    }
  });
}

/**
 * Заказчик отменяет заявку до договора. Неотвеченные отклики отклоняются; замер до выезда отменяется,
 * а после выезда фиксируется как «без сделки» с платой за выезд по условиям отклика (только запись).
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
    await tx.offer.updateMany({ where: { requestId: r.id, status: "SENT" }, data: { status: "DECLINED" } });

    const accepted = affected.find((o) => o.status === "ACCEPTED");
    if (accepted) {
      const fee = accepted.measurementTerms === "FEE_IF_NO_DEAL" ? accepted.measurementFee : null;
      await tx.measurement.updateMany({ where: { offerId: accepted.id, status: "SCHEDULED" }, data: { status: "CANCELLED" } });
      await tx.measurement.updateMany({ where: { offerId: accepted.id, status: "DONE" }, data: { status: "NO_DEAL", feeAccrued: fee } });
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
    desiredDate: r.desiredDate,
    wishes: r.wishes,
    wizardStep: r.wizardStep,
    title: requestTitle(r),
    photos: await roomPhotos(photos),
    target,
  };
}
export type Draft = Awaited<ReturnType<typeof getDraft>>;

/**
 * Активные типы мебели для первого шага мастера. Справочник ведёт оператор.
 * INTEGRATOR: перенести в operator, если справочник появится в его index.ts.
 */
export async function listFurnitureTypes() {
  return db.furnitureType.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, slug: true, name: true } });
}

/** Работа из портфолио для «Хочу похожее»: тип и исполнитель без личных данных. */
export async function likeTarget(portfolioItemId: string) {
  const item = await db.portfolioItem.findFirst({
    where: { id: portfolioItemId, published: true },
    select: { id: true, title: true, furnitureTypeId: true, style: true, executor: { select: { publicNumber: true, segment: true } } },
  });
  return item ?? fail.notFound(e.portfolioNotFound);
}

/** «Мои заявки»: свои заявки с числом действующих откликов. */
export async function listMyRequests(user: CurrentUser) {
  requireClient(user);
  const rows = await db.request.findMany({
    where: { clientId: user.id },
    orderBy: { updatedAt: "desc" },
    include: {
      furnitureType: { select: { name: true } },
      _count: { select: { offers: { where: { status: { not: "WITHDRAWN" } } } } },
    },
  });
  return rows.map((r) => ({
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
    desiredDate: r.desiredDate,
    wishes: r.wishes,
    wizardStep: r.wizardStep,
    publishedAt: r.publishedAt,
    offersCount,
    chosen: chosen && {
      id: chosen.id,
      executorNumber: chosen.executor.publicNumber,
      price: chosen.price,
      measurementTerms: chosen.measurementTerms,
      measurementFee: chosen.measurementFee,
    },
    measurement: m && { id: m.id, status: m.status, scheduledAt: m.scheduledAt, finalPrice: m.finalPrice, result: m.result },
    deal,
  };
}
export type ClientRequest = Awaited<ReturnType<typeof getClientRequest>>;
