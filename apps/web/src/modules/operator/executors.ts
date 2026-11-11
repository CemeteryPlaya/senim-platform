import type { RegistrationStatus, Segment } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { recordAudit, scopeHistory } from "@/modules/audit";
import { actorOf, provisionExecutor, reviewExecutorRegistration, type CurrentUser } from "@/modules/identity";
import { notify } from "@/modules/notifications";
import { last4 } from "@/platform/crypto";
import { db, isUniqueViolation, Prisma, transaction } from "@/platform/db";
import { expectOneUpdated, fail } from "@/platform/errors";
import { assertOperator } from "./access";
import { toAuditView } from "./audit-view";
import type { AddExecutorInput, ChangeSegmentInput, ReviewRegistrationInput } from "./schemas";

const t = ru.operator;

/** Поля исполнителя, которые видит оператор. ИИН/БИН — только последние 4 цифры, телефон — тоже. */
const executorRow = {
  id: true,
  publicNumber: true,
  legalForm: true,
  legalName: true,
  binIinLast4: true,
  segment: true,
  status: true,
  rejectReason: true,
  about: true,
  yearsExperience: true,
  city: true,
  district: true,
  streetAddress: true,
  addedByOperator: true,
  createdAt: true,
  reviewedAt: true,
  specializations: { select: { name: true }, orderBy: { sortOrder: "asc" } },
} satisfies Prisma.ExecutorProfileSelect;

export async function listRegistrationQueue(user: CurrentUser) {
  assertOperator(user);
  return db.executorProfile.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" }, select: executorRow });
}

export async function listExecutors(user: CurrentUser, filter: { status?: RegistrationStatus } = {}) {
  assertOperator(user);
  return db.executorProfile.findMany({
    where: { status: filter.status },
    orderBy: { publicNumber: "asc" },
    select: executorRow,
  });
}

export async function getExecutorCard(user: CurrentUser, profileId: string) {
  assertOperator(user);
  const profile = await db.executorProfile.findUnique({
    where: { id: profileId },
    select: { ...executorRow, user: { select: { phone: true } }, _count: { select: { portfolio: true, deals: true } } },
  });
  if (!profile) return fail.notFound();
  const { user: owner, ...rest } = profile;
  const history = (await scopeHistory(`executor:${profileId}`)).map(toAuditView);
  return { ...rest, phoneLast4: last4(owner.phone), history };
}

export async function reviewRegistration(user: CurrentUser, input: ReviewRegistrationInput): Promise<void> {
  assertOperator(user);
  await reviewExecutorRegistration(user, input.profileId, input.decision);
}

/**
 * Оператор добавляет исполнителя сам: пользователя и реквизиты создаёт identity (provisionExecutor — ProvisionExecutor и
 * проекция User), затем транзакция web — профиль сразу APPROVED, с сегментом и пометкой addedByOperator, аудит и
 * уведомление. Прямой записи пользователя и шифртекстов в старой базе нет. Номер, у которого профиль уже есть, —
 * CONFLICT: identity ответил теми же реквизитами (повтор) или отказал party_exists (другие реквизиты).
 */
export async function addExecutor(user: CurrentUser, input: AddExecutorInput): Promise<{ profileId: string }> {
  assertOperator(user);
  const provisioned = await provisionExecutor(user, input);
  try {
    return await transaction(async (tx) => {
      if (await tx.executorProfile.findUnique({ where: { userId: provisioned.userId }, select: { id: true } })) fail.conflict(t.errors.phoneTaken);
      const { id: profileId } = await tx.executorProfile.create({
        data: {
          userId: provisioned.userId,
          ...provisioned.party,
          segment: input.segment,
          status: "APPROVED",
          addedByOperator: true,
          reviewedAt: new Date(),
        },
        select: { id: true },
      });
      await recordAudit(tx, {
        actor: actorOf(user),
        action: "executor.added_by_operator",
        entity: { type: "executor", id: profileId },
        scope: `executor:${profileId}`,
        after: { status: "APPROVED", segment: input.segment, legalForm: input.legalForm },
      });
      await notify(tx, { userId: provisioned.userId, kind: "executor.added", title: t.notifications.addedTitle, body: t.notifications.addedBody, link: "/executor/profile" });
      return { profileId };
    });
  } catch (e) {
    // Двойная отправка формы: оба вызова identity ответили одним и тем же, профиль создал первый.
    if (isUniqueViolation(e)) return fail.conflict(t.errors.phoneTaken);
    throw e;
  }
}

/** Смена сегмента подтверждённому исполнителю. `from` — сегмент, который видел оператор: защита от гонки. */
export async function changeSegment(user: CurrentUser, input: ChangeSegmentInput): Promise<void> {
  assertOperator(user);
  await transaction(async (tx) => {
    const updated = await tx.executorProfile.updateMany({
      where: { id: input.profileId, status: "APPROVED", segment: input.from },
      data: { segment: input.to },
    });
    expectOneUpdated(updated, t.errors.segmentChanged);
    const profile = await tx.executorProfile.findUniqueOrThrow({ where: { id: input.profileId }, select: { userId: true } });
    await recordAudit(tx, {
      actor: actorOf(user),
      action: "executor.segment.changed",
      entity: { type: "executor", id: input.profileId },
      scope: `executor:${input.profileId}`,
      before: { segment: input.from },
      after: { segment: input.to },
      meta: { reason: input.reason },
    });
    await notify(tx, {
      userId: profile.userId,
      kind: "executor.segment.changed",
      title: t.notifications.segmentTitle,
      body: t.notifications.segmentBody(segmentName(input.to), input.reason),
      link: "/executor/profile",
    });
  });
}

const segmentName = (s: Segment) => t.segments[s];
