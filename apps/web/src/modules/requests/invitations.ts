import "server-only";
import type { InvitationStatus } from "@/generated/prisma/enums";
import { executorDisplayOf, executorDisplays, sanitizeExecutorText, VISIBLE_EXECUTOR } from "@/modules/companies";
import type { CurrentUser } from "@/modules/identity";
import { notifyTemplate } from "@/modules/notifications";
import { ru } from "@/i18n/ru";
import { db, isUniqueViolation, transaction, type Tx } from "@/platform/db";
import { expectOneUpdated, fail } from "@/platform/errors";
import { auditByUser, loadExecutor, loadOwnRequest, requestTitle } from "./access";
import { pathOf, TZ_PATH } from "./flows";
import { declineInvitationSchema, INVITATIONS_PER_REQUEST, inviteExecutorSchema } from "./schema";
import { INVITATION_TRANSITIONS, transition } from "./transitions";

export { INVITATIONS_PER_REQUEST };

const e = ru.requests.errors;

export type InvitationView = { publicNumber: number; label: string; status: InvitationStatus; reason: string | null; createdAt: Date };

/**
 * Покупатель приглашает мастера своей ценовой группы к своему открытому заказу-тендеру (путь ТЗ). Видимость заказа не
 * меняется. Повтор по той же паре (заказ, мастер) — тот же ответ без новой записи, уведомления и аудита. Лимит и повтор
 * решаются под блокировкой строки заказа: параллельные приглашения идут по очереди.
 */
export async function inviteExecutor(user: CurrentUser, raw: { requestId: string; publicNumber: number; clientKey?: string }): Promise<{ invitationId: string; created: boolean }> {
  const parsed = inviteExecutorSchema.safeParse(raw);
  if (!parsed.success) return fail.validation(e.executorNotFound, { field: "publicNumber" });
  const input = parsed.data;
  try {
    return await transaction(async (tx) => {
      const own = await loadOwnRequest(tx, user, input.requestId);
      await tx.$queryRaw`SELECT id FROM "Request" WHERE id = ${own.id} FOR UPDATE`;
      // Состояние — после блокировки: отмену или отклик между чтением и блокировкой не пропускаем.
      const r = await loadOwnRequest(tx, user, input.requestId);
      if (r.status !== "OPEN" || r.mode !== "TENDER" || pathOf(r) !== TZ_PATH) return fail.conflict(e.invitationClosed);

      const executor = await tx.executorProfile.findFirst({
        where: { publicNumber: input.publicNumber, ...VISIBLE_EXECUTOR },
        select: { id: true, userId: true, segment: true },
      });
      if (!executor) return fail.notFound(e.executorNotFound);
      if (executor.userId === user.id) return fail.validation(e.selfInvite, { reason: "selfInvite" });
      if (!r.segment || executor.segment !== r.segment) return fail.validation(e.otherSegment, { reason: "otherSegment" });

      const existing = await tx.requestInvitation.findUnique({ where: { requestId_executorId: { requestId: r.id, executorId: executor.id } }, select: { id: true } });
      if (existing) return { invitationId: existing.id, created: false };
      if ((await tx.requestInvitation.count({ where: { requestId: r.id } })) >= INVITATIONS_PER_REQUEST) {
        return fail.conflict(e.invitationsLimit, { reason: "invitationsLimit" });
      }

      const invitation = await tx.requestInvitation.create({
        data: { requestId: r.id, executorId: executor.id, clientKey: input.clientKey ?? null },
        select: { id: true },
      });
      await auditByUser(tx, user, r.id, {
        action: "request.invitation.sent",
        entity: { type: "invitation", id: invitation.id },
        after: { executorId: executor.id, status: "INVITED" },
      });
      await notifyTemplate(tx, executor.userId, "request.invited", { requestId: r.id, requestTitle: requestTitle(r) });
      return { invitationId: invitation.id, created: true };
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    // Гонка за уникальный индекс (запасной путь): запись уже есть — тот же ответ.
    const found = await db.requestInvitation.findFirst({
      where: { requestId: input.requestId, executor: { publicNumber: input.publicNumber } },
      select: { id: true },
    });
    if (!found) throw err;
    return { invitationId: found.id, created: false };
  }
}

/** Мастер отказывается от приглашения с причиной (маска контактов). Отказ окончателен; повтор — CONFLICT. */
export async function declineInvitation(user: CurrentUser, raw: { requestId: string; reason: string }): Promise<void> {
  const parsed = declineInvitationSchema.safeParse(raw);
  if (!parsed.success) return fail.validation(ru.requests.validation.invitationReason, { field: "reason" });
  const input = parsed.data;
  await transaction(async (tx) => {
    const executor = await loadExecutor(tx, user);
    const invitation = await tx.requestInvitation.findUnique({ where: { requestId_executorId: { requestId: input.requestId, executorId: executor.id } } });
    if (!invitation) return fail.notFound(e.invitationNotFound);
    const to = transition(INVITATION_TRANSITIONS, "decline", invitation.status, "EXECUTOR", undefined, undefined);
    const reason = (await sanitizeExecutorText(tx, executor.id, input.reason)).text;
    expectOneUpdated(
      await tx.requestInvitation.updateMany({ where: { id: invitation.id, status: invitation.status }, data: { status: to, reason, decidedAt: new Date() } }),
      e.invitationDecided,
    );
    await auditByUser(tx, user, input.requestId, {
      action: "request.invitation.declined",
      entity: { type: "invitation", id: invitation.id },
      before: { status: invitation.status },
      after: { status: to },
    });
    await notifyDeclined(tx, input.requestId, executor.id, reason);
  });
}

async function notifyDeclined(tx: Tx, requestId: string, executorId: string, reason: string): Promise<void> {
  const r = await tx.request.findUniqueOrThrow({ where: { id: requestId }, include: { furnitureType: { select: { name: true } } } });
  const who = (await executorDisplayOf(tx, executorId)).label;
  await notifyTemplate(tx, r.clientId, "request.invitation_declined", { requestId, requestTitle: requestTitle(r), who, reason });
}

/** Приглашения своей заявки: мастер — по режиму показа имени (ADR-006), причина уже в маске. */
export async function listInvitations(user: CurrentUser, requestId: string): Promise<InvitationView[]> {
  await loadOwnRequest(db, user, requestId);
  const rows = await db.requestInvitation.findMany({
    where: { requestId },
    orderBy: { createdAt: "asc" },
    select: { status: true, reason: true, createdAt: true, executorId: true, executor: { select: { publicNumber: true } } },
  });
  const displays = await executorDisplays(db, rows.map((x) => x.executorId));
  return rows.map((x) => ({
    publicNumber: x.executor.publicNumber,
    label: displays.get(x.executorId)?.label ?? "",
    status: x.status,
    reason: x.reason,
    createdAt: x.createdAt,
  }));
}
