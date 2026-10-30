import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { actorOf, type CurrentUser } from "@/modules/identity";
import { recordAudit, type AuditInput } from "@/modules/audit";
import { ru } from "@/i18n/ru";
import type { Db } from "@/platform/db";
import { fail } from "@/platform/errors";

/**
 * Права и общие помощники сервиса. Защита от IDOR: заказчик находит только свои заявки,
 * исполнитель — только видимые ему заявки и свои отклики; чужое — «не найдено».
 */

const e = ru.requests.errors;

export function requireClient(user: CurrentUser): void {
  if (user.role !== "CLIENT") fail.forbidden();
}

export type ExecutorRow = {
  id: string;
  userId: string;
  publicNumber: number;
  segment: "ECONOMY" | "COMFORT" | "PREMIUM" | null;
  measurementTerms: "FREE" | "INCLUDED" | "FEE_IF_NO_DEAL";
  measurementFee: number | null;
};

/** Подтверждённый оператором исполнитель (статус и сегмент — из БД, а не из сессии). */
export async function loadExecutor(tx: Db, user: CurrentUser): Promise<ExecutorRow> {
  if (user.role !== "EXECUTOR" || !user.executor) return fail.forbidden();
  const p = await tx.executorProfile.findUnique({
    where: { id: user.executor.id },
    select: { id: true, userId: true, publicNumber: true, segment: true, status: true, measurementTerms: true, measurementFee: true },
  });
  if (!p || p.userId !== user.id || p.status !== "APPROVED") return fail.forbidden(e.notApproved);
  return p;
}

const requestWithType = { furnitureType: { select: { name: true } } } satisfies Prisma.RequestInclude;
export type RequestWithType = Prisma.RequestGetPayload<{ include: typeof requestWithType }>;

/** Своя заявка заказчика. */
export async function loadOwnRequest(tx: Db, user: CurrentUser, requestId: string): Promise<RequestWithType> {
  requireClient(user);
  const r = await tx.request.findFirst({ where: { id: requestId, clientId: user.id }, include: requestWithType });
  return r ?? fail.notFound(e.notFound);
}

/** Название заявки для списков и уведомлений: тип из справочника или свой вариант. */
export function requestTitle(r: { furnitureType: { name: string } | null; customType: string | null }): string {
  return r.furnitureType?.name ?? r.customType ?? ru.requests.untitled;
}

export const requestScope = (requestId: string) => `request:${requestId}`;

/** Событие журнала заявки от имени пользователя. */
export function auditByUser(tx: Db, user: CurrentUser, requestId: string, input: Omit<AuditInput, "actor" | "scope">) {
  return recordAudit(tx, { ...input, actor: actorOf(user), scope: requestScope(requestId) });
}

/** Ссылки в уведомлениях (совпадают с маршрутами экранов и сидом). */
export const links = {
  client: (requestId: string) => `/requests/${requestId}`,
  executor: (requestId: string) => `/executor/requests/${requestId}`,
};
