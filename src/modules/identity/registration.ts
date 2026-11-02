import "server-only";
import { ru } from "@/i18n/ru";
import { recordAudit } from "@/modules/audit";
import { notify } from "@/modules/notifications";
import { decryptPii, encryptPii, hashPii, last4 } from "@/platform/crypto";
import { db, isUniqueViolation, transaction, type Tx } from "@/platform/db";
import { expectOneUpdated, fail } from "@/platform/errors";
import { enforceRateLimit } from "@/platform/rate-limit";
import type { ReviewExecutorRegistration } from "./index";
import { usesOwnIin, type ExecutorRegistrationInput, type ExecutorSigner } from "./registration-schema";
import { EXECUTOR_REGISTRATION_PATH } from "./return-to";
import { actorOf, grantRole, type CurrentUser } from "./session";

export { executorRegistrationSchema, type ExecutorRegistrationInput, type ExecutorSigner } from "./registration-schema";

const t = ru.identity.registration;

/** Ответ «ИИН/БИН уже зарегистрирован» раскрывает, кто исполнитель: перебор ограничен 5 попытками в час на пользователя. */
const REGISTRATION_LIMIT = { limit: 5, windowSec: 3600 };

const entityOf = (profileId: string) => ({ entity: { type: "executor", id: profileId }, scope: `executor:${profileId}` });

/**
 * Столбцы подписанта в профиле исполнителя (ADR-003). ИИН — только у директора ТОО: зашифрованный и HMAC
 * для сверки с сертификатом ЭЦП, без уникальности (один директор у нескольких ТОО). У ИП и самозанятого
 * null: они подписывают ИИН профиля. Повторная анкета перезаписывает подписанта целиком.
 */
export function signerColumns(signer: ExecutorSigner) {
  return {
    signerFullName: signer.fullName,
    signerIinEnc: signer.iin === null ? null : encryptPii(signer.iin),
    signerIinHash: signer.iin === null ? null : hashPii(signer.iin),
  };
}

function profileData(input: ExecutorRegistrationInput) {
  return {
    legalForm: input.legalForm,
    legalName: input.legalName,
    binIinEnc: encryptPii(input.binIin),
    binIinHash: hashPii(input.binIin),
    binIinLast4: last4(input.binIin),
    ...signerColumns(input.signer),
    city: input.city,
    district: input.district ?? "",
    streetAddress: input.streetAddress ?? "",
    yearsExperience: input.yearsExperience,
  };
}

/** Профиль: новый или повторная подача после отказа (тот же профиль снова PENDING). */
async function upsertPendingProfile(tx: Tx, userId: string, input: ExecutorRegistrationInput): Promise<string> {
  const sameBinIin = await tx.executorProfile.findUnique({ where: { binIinHash: hashPii(input.binIin) }, select: { userId: true } });
  if (sameBinIin && sameBinIin.userId !== userId) return fail.conflict(t.errors.binIinTaken);
  const existing = await tx.executorProfile.findUnique({ where: { userId }, select: { id: true } });
  if (!existing) return (await tx.executorProfile.create({ data: { userId, ...profileData(input) }, select: { id: true } })).id;
  // Подать снова можно только после отказа: PENDING и APPROVED не обновятся — конфликт.
  const resubmitted = await tx.executorProfile.updateMany({
    where: { id: existing.id, status: "REJECTED" },
    data: { ...profileData(input), status: "PENDING", rejectReason: null, reviewedAt: null },
  });
  expectOneUpdated(resubmitted, t.errors.alreadyRegistered);
  return existing.id;
}

/**
 * Регистрация исполнителя: профиль PENDING, ИИН/БИН и ИИН подписанта только зашифрованными, роль EXECUTOR
 * добавляется к выданным (заказчик остаётся заказчиком, ADR-004), уведомление каждому оператору.
 * ФИО и ИИН аккаунта не трогает: подписант — свойство профиля (ADR-003). Активную роль сессии
 * переключает вызывающий (switchRole) — сервис о cookie не знает.
 */
export async function registerExecutor(user: CurrentUser, input: ExecutorRegistrationInput): Promise<{ profileId: string }> {
  if (user.role === "OPERATOR") return fail.forbidden(t.errors.operator);
  await enforceRateLimit(`registration:user:${user.id}`, REGISTRATION_LIMIT, t.errors.tooMany);

  return register(user, await withOwnIin(user, input)).catch((e: unknown) => {
    // Два разных номера одновременно с одним ИИН/БИН: проверку прошли оба, сработал уникальный индекс.
    if (isUniqueViolation(e)) return fail.conflict(t.errors.binIinTaken);
    throw e;
  });
}

/** ИП и самозанятый по ИИН из знакомства (№26): ИИН берётся из аккаунта, а не вводится второй раз. */
async function withOwnIin(user: CurrentUser, input: ExecutorRegistrationInput): Promise<ExecutorRegistrationInput> {
  if (!usesOwnIin(input)) return input;
  const { iinEnc } = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { iinEnc: true } });
  if (!iinEnc) return fail.validation(t.errors.ownIinMissing, { fieldErrors: { binIin: [t.errors.ownIinMissing] } });
  return { ...input, binIin: decryptPii(iinEnc) };
}

function register(user: CurrentUser, input: ExecutorRegistrationInput): Promise<{ profileId: string }> {
  return transaction(async (tx) => {
    // Блокировка строки пользователя: двойная отправка формы выполняется последовательно.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`;

    const profileId = await upsertPendingProfile(tx, user.id, input);
    // Роль добавляется к выданным: CLIENT и вся история заказчика остаются (ADR-004).
    await grantRole(tx, user, "EXECUTOR");

    await recordAudit(tx, {
      actor: actorOf({ id: user.id, role: "EXECUTOR" }),
      action: "executor.registered",
      ...entityOf(profileId),
      after: { status: "PENDING", legalForm: input.legalForm },
    });
    const operators = await tx.user.findMany({ where: { roles: { has: "OPERATOR" }, blockedAt: null }, select: { id: true } });
    for (const op of operators) {
      await notify(tx, {
        userId: op.id,
        kind: "registration.pending",
        title: t.notifyOperator.title,
        body: t.notifyOperator.body(t.legalForms[input.legalForm], input.legalName),
        link: `/operator/executors/${profileId}`,
      });
    }
    return { profileId };
  });
}

export type MyRegistration = {
  status: "PENDING" | "APPROVED" | "REJECTED";
  legalForm: ExecutorRegistrationInput["legalForm"];
  legalName: string;
  binIinLast4: string;
  rejectReason: string | null;
};

/** Статус своей регистрации для экрана исполнителя (ИИН/БИН — только последние 4 цифры). */
export async function getMyRegistration(user: CurrentUser): Promise<MyRegistration | null> {
  if (!user.executor) return null;
  return db.executorProfile.findUnique({
    where: { id: user.executor.id },
    select: { status: true, legalForm: true, legalName: true, binIinLast4: true, rejectReason: true },
  });
}

/** operator → identity: подтверждение (с сегментом) или отказ (с причиной) регистрации в статусе PENDING. */
export const reviewExecutorRegistration: ReviewExecutorRegistration = async (operator, profileId, decision) => {
  if (operator.role !== "OPERATOR") fail.forbidden();
  const reason = decision.approve ? null : decision.reason.trim();
  if (reason === "") fail.validation(t.errors.rejectReason);

  await transaction(async (tx) => {
    const profile = await tx.executorProfile.findUnique({ where: { id: profileId }, select: { userId: true, segment: true } });
    if (!profile) return fail.notFound();

    const now = new Date();
    const data = decision.approve
      ? { status: "APPROVED" as const, segment: decision.segment, reviewedAt: now }
      : { status: "REJECTED" as const, rejectReason: reason, reviewedAt: now };
    expectOneUpdated(await tx.executorProfile.updateMany({ where: { id: profileId, status: "PENDING" }, data }), t.errors.alreadyReviewed);

    await recordAudit(tx, {
      actor: actorOf(operator),
      action: decision.approve ? "executor.approved" : "executor.rejected",
      ...entityOf(profileId),
      before: { status: "PENDING", segment: profile.segment },
      after: decision.approve ? { status: "APPROVED", segment: decision.segment } : { status: "REJECTED" },
      meta: reason ? { reason } : undefined,
    });
    await notify(
      tx,
      decision.approve
        ? { userId: profile.userId, kind: "registration.approved", title: t.notifyExecutor.approvedTitle, body: t.notifyExecutor.approvedBody, link: "/executor/requests" }
        : { userId: profile.userId, kind: "registration.rejected", title: t.notifyExecutor.rejectedTitle, body: t.notifyExecutor.rejectedBody(reason ?? ""), link: EXECUTOR_REGISTRATION_PATH },
    );
  });
};
