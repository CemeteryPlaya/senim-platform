import "server-only";
import { actorOf, type CurrentUser } from "@/modules/identity";
import { recordAudit } from "@/modules/audit";
import { notify } from "@/modules/notifications";
import { ru } from "@/i18n/ru";
import { db, isUniqueViolation, transaction, type Db } from "@/platform/db";
import { fail } from "@/platform/errors";
import { links, requestScope, requestTitle } from "./access";

/**
 * Повторный отклик (№16). Правило ADR-003 «один отклик на исполнителя» остаётся: отклонённый исполнитель
 * снова откликнуться не может. Оператор может снять блокировку для конкретного исполнителя и заявки —
 * с причиной и записью в журнал; тогда исполнителю разрешена следующая попытка (Offer.round).
 * Уникальные (requestId, executorId, round) у отклика и у разрешения: двойной клик и гонка — один эффект.
 */

const pe = ru.requests.pre.errors;

/** Какую попытку исполнитель может сделать сейчас: 1 или последнюю разрешённую оператором. */
export async function allowedRound(tx: Db, requestId: string, executorId: string): Promise<number> {
  const last = await tx.offerRetry.findFirst({ where: { requestId, executorId }, orderBy: { round: "desc" }, select: { round: true } });
  return last?.round ?? 1;
}

export async function allowOfferRetry(operator: CurrentUser, input: { requestId: string; executorId: string; reason: string }): Promise<void> {
  if (operator.role !== "OPERATOR") fail.forbidden();
  try {
    await transaction(async (tx) => {
      const r = await tx.request.findUnique({ where: { id: input.requestId }, include: { furnitureType: { select: { name: true } } } });
      if (!r) return fail.notFound(ru.requests.errors.notFound);
      const last = await tx.offer.findFirst({
        where: { requestId: r.id, executorId: input.executorId },
        orderBy: { round: "desc" },
        include: { executor: { select: { userId: true } } },
      });
      if (r.status !== "OPEN" || last?.status !== "DECLINED") return fail.conflict(pe.retryNotAllowed);
      const round = last.round + 1;
      const retry = await tx.offerRetry.create({ data: { requestId: r.id, executorId: input.executorId, round, reason: input.reason, operatorId: operator.id } });
      await recordAudit(tx, {
        actor: actorOf(operator),
        action: "offer.retry_allowed",
        entity: { type: "offerRetry", id: retry.id },
        scope: requestScope(r.id),
        after: { executorId: input.executorId, round },
        meta: { reason: input.reason, previousOfferId: last.id },
      });
      const text = ru.requests.pre.notify.retryAllowed;
      await notify(tx, { userId: last.executor.userId, kind: "offer.retry_allowed", title: text.title, body: text.body(requestTitle(r)), link: links.executor(r.id) });
    });
  } catch (err) {
    if (isUniqueViolation(err)) return fail.conflict(pe.retryExists);
    throw err;
  }
}

/** Для оператора: отклонённые исполнители открытых заявок, которым повтор ещё не разрешён. */
export async function listRetryCandidates(operator: CurrentUser) {
  if (operator.role !== "OPERATOR") fail.forbidden();
  const offers = await db.offer.findMany({
    where: { status: "DECLINED", request: { status: "OPEN" } },
    orderBy: { updatedAt: "desc" },
    include: {
      executor: { select: { publicNumber: true } },
      measurement: { select: { status: true } },
      request: { include: { furnitureType: { select: { name: true } }, offers: { select: { executorId: true, round: true } }, offerRetries: { select: { executorId: true, round: true } } } },
    },
  });
  // Только последняя попытка исполнителя и только если следующая ещё не разрешена.
  return offers
    .filter((o) => !o.request.offers.some((x) => x.executorId === o.executorId && x.round > o.round))
    .filter((o) => !o.request.offerRetries.some((x) => x.executorId === o.executorId && x.round > o.round))
    .map((o) => ({
      offerId: o.id,
      requestId: o.requestId,
      requestNumber: o.request.number,
      requestTitle: requestTitle(o.request),
      executorId: o.executorId,
      executorNumber: o.executor.publicNumber,
      afterNoDeal: o.measurement?.status === "NO_DEAL",
    }));
}
