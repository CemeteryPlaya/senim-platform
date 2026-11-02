import "server-only";
import { attachFiles } from "@/modules/files";
import { actorOf, type CurrentUser } from "@/modules/identity";
import { notify } from "@/modules/notifications";
import { recordAudit } from "@/modules/audit";
import { ru } from "@/i18n/ru";
import { db, isUniqueViolation, transaction, type Tx } from "@/platform/db";
import { expectOneUpdated, fail } from "@/platform/errors";
import { links, requestScope, requestTitle, type RequestWithType } from "./access";
import { roomPhotos } from "./adapters";
import { announceToExecutors, executorRecipients } from "./announce";
import { flowOf } from "./flows";
import type { CompleteSiteMeasurementInput } from "./pre-contract-schema";
import { parseDetails } from "./schema";
import { REQUEST_TRANSITIONS, SITE_MEASUREMENT_TRANSITIONS, stored, transition } from "./transitions";

/**
 * Замер площадки (сценарий 2, ADR-005): оператор назначает замерщика-сотрудника, замерщик снимает размеры,
 * заметки и фото — после этого заявка открывается исполнителям, и все считают по одним размерам.
 */

const pe = ru.requests.pre.errors;
const pn = ru.requests.pre.notify;
const withType = { furnitureType: { select: { name: true } } } as const;

function requireRole(user: CurrentUser, role: "OPERATOR" | "MEASURER"): void {
  if (user.role !== role) fail.forbidden();
}

const audit = (tx: Tx, user: CurrentUser, requestId: string, input: Omit<Parameters<typeof recordAudit>[1], "actor" | "scope">) =>
  recordAudit(tx, { ...input, actor: actorOf(user), scope: requestScope(requestId) });

/** Заявка ждёт замерщика: уведомление всем операторам. */
export async function notifyOperatorsSiteMeasure(tx: Tx, r: RequestWithType): Promise<void> {
  const operators = await tx.user.findMany({ where: { roles: { has: "OPERATOR" }, blockedAt: null }, select: { id: true } });
  for (const o of operators) {
    await notify(tx, { userId: o.id, kind: "request.site_measure", title: pn.siteNeeded.title, body: pn.siteNeeded.body(requestTitle(r)), link: "/operator/requests" });
  }
}

/** Оператор назначает замерщика на заявку PLATFORM_MEASURING. Повтор и гонка — CONFLICT (один замер на заявку). */
export async function assignSiteMeasurer(operator: CurrentUser, input: { requestId: string; measurerId: string }): Promise<void> {
  requireRole(operator, "OPERATOR");
  try {
    await transaction(async (tx) => {
      const r = await tx.request.findUnique({ where: { id: input.requestId }, include: { ...withType, siteMeasurement: true } });
      if (!r) return fail.notFound(ru.requests.errors.notFound);
      const to = stored(transition(SITE_MEASUREMENT_TRANSITIONS, "assign", r.siteMeasurement?.status ?? "NONE", "OPERATOR", flowOf(r)));
      if (r.status !== "PLATFORM_MEASURING") fail.conflict();
      const measurer = await tx.user.findFirst({ where: { id: input.measurerId, roles: { has: "MEASURER" }, blockedAt: null }, select: { id: true, fullName: true } });
      if (!measurer) return fail.notFound(pe.measurerNotFound);
      // Самосделка: замерщик не может быть стороной заявки (роль сотрудника и так не совмещается с заказчиком — ADR-004).
      if (measurer.id === r.clientId) return fail.conflict(pe.measurerIsParty);

      const sm = await tx.siteMeasurement.create({ data: { requestId: r.id, measurerId: measurer.id, assignedById: operator.id, status: to } });
      await audit(tx, operator, r.id, { action: "site_measurement.assigned", entity: { type: "siteMeasurement", id: sm.id }, after: { status: to, measurerId: measurer.id } });
      const title = requestTitle(r);
      await notify(tx, { userId: measurer.id, kind: "site_measurement.assigned", title: pn.siteAssigned.title, body: pn.siteAssigned.body(title), link: `/measurer/${sm.id}` });
      await notify(tx, { userId: r.clientId, kind: "site_measurement.assigned", title: pn.siteAssignedClient.title, body: pn.siteAssignedClient.body(title), link: links.client(r.id) });
    });
  } catch (err) {
    if (isUniqueViolation(err)) return fail.conflict();
    throw err;
  }
}

/** Замерщик вносит размеры, заметки и фото: замер DONE, заявка PLATFORM_MEASURING → OPEN, исполнителям — уведомления. */
export async function completeSiteMeasurement(measurer: CurrentUser, input: CompleteSiteMeasurementInput): Promise<void> {
  requireRole(measurer, "MEASURER");
  await transaction(async (tx) => {
    const sm = await tx.siteMeasurement.findFirst({ where: { id: input.siteMeasurementId, measurerId: measurer.id }, include: { request: { include: withType } } });
    if (!sm) return fail.notFound(pe.siteNotFound);
    const r = sm.request;
    const flow = flowOf(r);
    const smTo = stored(transition(SITE_MEASUREMENT_TRANSITIONS, "complete", sm.status, "MEASURER", flow));
    const requestTo = transition(REQUEST_TRANSITIONS, "siteMeasured", r.status, "MEASURER", flow);
    const recipients = await executorRecipients(tx, r);

    const data = { status: smTo, widthCm: input.widthCm, heightCm: input.heightCm, depthCm: input.depthCm, notes: input.notes, doneAt: new Date() };
    expectOneUpdated(await tx.siteMeasurement.updateMany({ where: { id: sm.id, status: sm.status }, data }));
    expectOneUpdated(await tx.request.updateMany({ where: { id: r.id, status: r.status }, data: { status: requestTo, publishedAt: new Date() } }));
    if (input.photoFileIds.length > 0) await attachFiles(tx, { fileIds: input.photoFileIds, uploadedById: measurer.id, owner: { requestId: r.id } });

    await audit(tx, measurer, r.id, {
      action: "site_measurement.done",
      entity: { type: "siteMeasurement", id: sm.id },
      before: { status: sm.status, request: r.status },
      after: { status: smTo, request: requestTo, widthCm: input.widthCm, heightCm: input.heightCm, depthCm: input.depthCm, photos: input.photoFileIds.length },
      meta: { recipients: recipients.length },
    });
    const title = requestTitle(r);
    await notify(tx, { userId: r.clientId, kind: "site_measurement.done", title: pn.siteDone.title, body: pn.siteDone.body(title), link: links.client(r.id) });
    await announceToExecutors(tx, r, recipients);
  });
}

// ─── чтение ──────────────────────────────────────────────────────────────────

/** Замеры замерщика: сначала назначенные. */
export async function listMySiteMeasurements(measurer: CurrentUser) {
  requireRole(measurer, "MEASURER");
  const rows = await db.siteMeasurement.findMany({
    where: { measurerId: measurer.id },
    orderBy: [{ status: "asc" }, { assignedAt: "desc" }],
    include: { request: { include: withType } },
  });
  return rows.map((sm) => ({
    id: sm.id,
    status: sm.status,
    assignedAt: sm.assignedAt,
    doneAt: sm.doneAt,
    request: { number: sm.request.number, title: requestTitle(sm.request), city: sm.request.city, address: sm.request.address },
  }));
}

/** Замер для замерщика: заявка, адрес (замерщику он нужен для выезда) и его результат. Чужой — «не найдено». */
export async function getSiteMeasurement(measurer: CurrentUser, siteMeasurementId: string) {
  requireRole(measurer, "MEASURER");
  const sm = await db.siteMeasurement.findFirst({ where: { id: siteMeasurementId, measurerId: measurer.id }, include: { request: { include: withType } } });
  if (!sm) return fail.notFound(pe.siteNotFound);
  const photos = await db.storedFile.findMany({
    where: { requestId: sm.requestId, purpose: "REQUEST_ROOM", uploadedById: measurer.id },
    orderBy: { sortOrder: "asc" },
    select: { id: true, provider: true, storageKey: true },
  });
  const r = sm.request;
  return {
    id: sm.id,
    status: sm.status,
    widthCm: sm.widthCm,
    heightCm: sm.heightCm,
    depthCm: sm.depthCm,
    notes: sm.notes,
    doneAt: sm.doneAt,
    photos: await roomPhotos(photos),
    request: {
      number: r.number,
      title: requestTitle(r),
      style: r.style,
      details: parseDetails(r.details),
      city: r.city,
      address: r.address,
      desiredDate: r.desiredDate,
      wishes: r.wishes,
    },
  };
}
export type SiteMeasurementView = Awaited<ReturnType<typeof getSiteMeasurement>>;

/** Для оператора: заявки, которые ждут замерщика площадки, и список замерщиков. */
export async function listAwaitingSiteMeasurer(operator: CurrentUser) {
  requireRole(operator, "OPERATOR");
  const [requests, measurers] = await Promise.all([
    db.request.findMany({
      where: { status: "PLATFORM_MEASURING" },
      orderBy: { publishedAt: "asc" },
      include: { ...withType, siteMeasurement: { include: { measurer: { select: { fullName: true, phone: true } } } } },
    }),
    db.user.findMany({ where: { roles: { has: "MEASURER" }, blockedAt: null }, select: { id: true, fullName: true, phone: true }, orderBy: { fullName: "asc" } }),
  ]);
  return {
    requests: requests.map((r) => ({
      id: r.id,
      number: r.number,
      title: requestTitle(r),
      city: r.city,
      publishedAt: r.publishedAt,
      measurer: r.siteMeasurement ? (r.siteMeasurement.measurer.fullName ?? r.siteMeasurement.measurer.phone) : null,
    })),
    measurers: measurers.map((m) => ({ id: m.id, name: m.fullName ?? m.phone })),
  };
}
