import "server-only";
import { randomUUID } from "node:crypto";
import type { Party } from "@/gen/senim/identity/v1/identity_pb";
import { ru } from "@/i18n/ru";
import { recordAudit } from "@/modules/audit";
import { notify } from "@/modules/notifications";
import { last4 } from "@/platform/crypto";
import { db, transaction, type Tx } from "@/platform/db";
import { expectOneUpdated, fail } from "@/platform/errors";
import { enforceRateLimit } from "@/platform/rate-limit";
import type { ReviewExecutorRegistration } from "./index";
import { legalFormToProto, ownParty, partyColumns, projectParty, projectUser, type PartyColumns } from "./projection";
import { identity } from "./remote";
import { retriedOnce } from "./remote-errors";
import { usesOwnIin, type ExecutorRegistrationInput } from "./registration-schema";
import { EXECUTOR_REGISTRATION_PATH } from "./return-to";
import { actorOf, currentSessionToken, grantRole, type CurrentUser } from "./session";
import { isStaffRole } from "./roles";

export { executorRegistrationSchema, type ExecutorRegistrationInput, type ExecutorSigner } from "./registration-schema";

const t = ru.identity.registration;

/** Ответ «ИИН/БИН уже зарегистрирован» раскрывает, кто исполнитель: перебор ограничен 5 попытками в час на пользователя. */
const REGISTRATION_LIMIT = { limit: 5, windowSec: 3600 };

const entityOf = (profileId: string) => ({ entity: { type: "executor", id: profileId }, scope: `executor:${profileId}` });

/** Поля анкеты, которые остаются в web: адрес мастерской и опыт. Реквизиты — проекция стороны identity (partyColumns). */
const localColumns = (input: ExecutorRegistrationInput) => ({
  city: input.city,
  district: input.district ?? "",
  streetAddress: input.streetAddress ?? "",
  yearsExperience: input.yearsExperience,
});

/** Профиль: новый или повторная подача после отказа (тот же профиль снова PENDING). */
async function upsertPendingProfile(tx: Tx, userId: string, input: ExecutorRegistrationInput, party: Party): Promise<string> {
  const existing = await tx.executorProfile.findUnique({ where: { userId }, select: { id: true } });
  if (!existing) return (await tx.executorProfile.create({ data: { userId, ...partyColumns(party), ...localColumns(input) }, select: { id: true } })).id;
  // Подать снова можно только после отказа: PENDING и APPROVED не обновятся — конфликт.
  const resubmitted = await tx.executorProfile.updateMany({
    where: { id: existing.id, status: "REJECTED" },
    data: { ...localColumns(input), status: "PENDING", rejectReason: null, reviewedAt: null },
  });
  expectOneUpdated(resubmitted, t.errors.alreadyRegistered);
  await projectParty(party, tx);
  return existing.id;
}

/**
 * Регистрация исполнителя (как «роль, потом профиль» плана 2): роль EXECUTOR добавляется к выданным в identity (заказчик
 * остаётся заказчиком, ADR-004), затем реквизиты — RegisterParty (ИИН/БИН и ИИН подписанта шифрует и проверяет на
 * занятость identity), затем транзакция web: профиль PENDING с адресом, опытом и проекцией стороны, аудит и уведомление
 * каждому оператору. Шифртекстов и HMAC web не пишет. ФИО и ИИН аккаунта не трогает: подписант — свойство стороны
 * (ADR-003). Активную роль сессии переключает вызывающий (switchRole) — сервис о cookie не знает.
 */
export async function registerExecutor(user: CurrentUser, input: ExecutorRegistrationInput): Promise<{ profileId: string }> {
  if (isStaffRole(user.role)) return fail.forbidden(t.errors.operator);
  await enforceRateLimit(`registration:user:${user.id}`, REGISTRATION_LIMIT, t.errors.tooMany);
  await assertOwnIin(user.id, input);
  // Роль выдаётся в identity до реквизитов и транзакции старой базы: GrantRole идемпотентен по существу (роль уже есть —
  // granted=false), повтор безопасен; RegisterParty без роли identity отклонит. Роль уже есть в проекции (прежняя
  // попытка, подача после отказа) — вызов не нужен.
  if (!user.roles.includes("EXECUTOR")) await grantRole("EXECUTOR");
  const party = await registerParty(user, input);
  return register(user, input, party);
}

/**
 * ИП и самозанятый работают по ИИН владельца аккаунта: identity берёт его из личности и ИИН анкеты не читает. Снята
 * отметка «свой ИИН» и введён другой номер — ошибка у поля, а не молча другой ИИН в профиле. Сверка — по последним 4
 * цифрам проекции (сам ИИН в web не хранится); ИИН в аккаунте нет — ответит identity (person_missing).
 */
async function assertOwnIin(userId: string, input: ExecutorRegistrationInput): Promise<void> {
  if (input.legalForm === "TOO" || usesOwnIin(input)) return;
  const { iinLast4 } = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { iinLast4: true } });
  if (iinLast4 === null || last4(input.binIin) === iinLast4) return;
  const message = t.errors.notOwnIin(iinLast4);
  fail.validation(message, { fieldErrors: { binIin: [message] } });
}

/**
 * Реквизиты — в identity (RegisterParty в сессии этого браузера). Ключ идемпотентности — один на попытку формы: обрыв
 * связи повторяется с ним же. ИИН/БИН ИП и самозанятого не передаётся (identity берёт ИИН личности). «ИИН/БИН занят»
 * здесь — текст о реквизитах, а не об ИИН личности.
 */
async function registerParty(user: Pick<CurrentUser, "id">, input: ExecutorRegistrationInput): Promise<Party> {
  const sessionToken = await currentSessionToken();
  const request = {
    sessionToken,
    legalForm: legalFormToProto(input.legalForm),
    legalName: input.legalName,
    binIin: input.legalForm === "TOO" ? input.binIin : "",
    signerFullName: input.signer.fullName,
    signerIin: input.signer.iin ?? "",
    idempotencyKey: randomUUID(),
  };
  const res = await retriedOnce(() => identity().registerParty(request), { iin_taken: () => fail.conflict(t.errors.binIinTaken) });
  return ownParty(user.id, res.party);
}

/** Реквизиты исполнителя, которого добавляет оператор (operator.addExecutor): телефон и анкета без адреса. */
export type ProvisionExecutorInput = Pick<ExecutorRegistrationInput, "legalForm" | "legalName" | "binIin" | "signer"> & { phone: string };

const operatorErrors = ru.operator.errors;

/**
 * operator → identity: «Добавить исполнителя». ProvisionExecutor в сессии оператора (нужна пройденная вторая ступень —
 * иначе MFA_REQUIRED) создаёт пользователя по телефону с ролью EXECUTOR или добавляет роль существующему и записывает
 * реквизиты; ответ — в проекцию `User` (тот же id). Профиль исполнителя создаёт вызывающий в своей транзакции из
 * возвращённых столбцов (partyColumns): сегмент и пометка «добавлен оператором» — данные web. Ключ — на попытку формы.
 */
export async function provisionExecutor(operator: CurrentUser, input: ProvisionExecutorInput): Promise<{ userId: string; party: PartyColumns }> {
  if (operator.role !== "OPERATOR") return fail.forbidden();
  const sessionToken = await currentSessionToken();
  const request = {
    sessionToken,
    phone: input.phone,
    legalForm: legalFormToProto(input.legalForm),
    legalName: input.legalName,
    binIin: input.binIin,
    signerFullName: input.signer.fullName,
    signerIin: input.signer.iin ?? "",
    idempotencyKey: randomUUID(),
  };
  const res = await retriedOnce(() => identity().provisionExecutor(request), {
    iin_taken: () => fail.conflict(operatorErrors.binIinTaken),
    party_exists: () => fail.conflict(operatorErrors.partyExists),
    role_forbidden: () => fail.conflict(operatorErrors.staffPhone),
    user_blocked: () => fail.conflict(operatorErrors.phoneBlocked),
  });
  if (!res.user) return fail.unavailable(ru.common.errors.generic);
  const party = ownParty(res.user.id, res.party);
  await projectUser(res.user);
  return { userId: res.user.id, party: partyColumns(party) };
}

function register(user: CurrentUser, input: ExecutorRegistrationInput, party: Party): Promise<{ profileId: string }> {
  return transaction(async (tx) => {
    // Блокировка строки пользователя: двойная отправка формы выполняется последовательно.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`;

    const profileId = await upsertPendingProfile(tx, user.id, input, party);
    // Роль EXECUTOR уже выдана в identity (registerExecutor) и записана в проекцию: строка пользователя блокируется выше с ней.
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
