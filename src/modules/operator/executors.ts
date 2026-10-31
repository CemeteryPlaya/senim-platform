import type { RegistrationStatus, Segment } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { recordAudit, scopeHistory } from "@/modules/audit";
import { actorOf, reviewExecutorRegistration, signerColumns, type CurrentUser } from "@/modules/identity";
import { notify } from "@/modules/notifications";
import { encryptPii, hashPii, last4 } from "@/platform/crypto";
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

/** Оператор добавляет исполнителя сам: сразу APPROVED, с сегментом и пометкой addedByOperator. */
export async function addExecutor(user: CurrentUser, input: AddExecutorInput): Promise<{ profileId: string }> {
  assertOperator(user);
  try {
    return await transaction(async (tx) => {
      if (await tx.user.findUnique({ where: { phone: input.phone }, select: { id: true } })) fail.conflict(t.errors.phoneTaken);
      if (await tx.executorProfile.findUnique({ where: { binIinHash: hashPii(input.binIin) }, select: { id: true } })) fail.conflict(t.errors.binIinTaken);
      // Подписант договора — свойство профиля, а не аккаунта (ADR-003): ФИО и ИИН аккаунта не заполняются.
      const created = await tx.user.create({
        data: {
          phone: input.phone,
          role: "EXECUTOR",
          executorProfile: {
            create: {
              legalForm: input.legalForm,
              legalName: input.legalName,
              binIinEnc: encryptPii(input.binIin),
              binIinHash: hashPii(input.binIin),
              binIinLast4: last4(input.binIin),
              ...signerColumns(input.signer),
              segment: input.segment,
              status: "APPROVED",
              addedByOperator: true,
              reviewedAt: new Date(),
            },
          },
        },
        select: { id: true, executorProfile: { select: { id: true } } },
      });
      const profileId = created.executorProfile!.id;
      await recordAudit(tx, {
        actor: actorOf(user),
        action: "executor.added_by_operator",
        entity: { type: "executor", id: profileId },
        scope: `executor:${profileId}`,
        after: { status: "APPROVED", segment: input.segment, legalForm: input.legalForm },
      });
      await notify(tx, { userId: created.id, kind: "executor.added", title: t.notifications.addedTitle, body: t.notifications.addedBody, link: "/executor/profile" });
      return { profileId };
    });
  } catch (e) {
    // Параллельное добавление того же телефона или ИИН/БИН: уникальный индекс сработал после нашей проверки.
    if (isUniqueViolation(e)) return fail.conflict(t.errors.duplicate);
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
