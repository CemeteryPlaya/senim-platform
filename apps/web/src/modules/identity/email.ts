import "server-only";
import { randomUUID } from "node:crypto";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { z } from "zod";
import { ru } from "@/i18n/ru";
import { digitsOnly } from "@/platform/digits";
import { AppError, fail } from "@/platform/errors";
import { logger } from "@/platform/logger";
import { ownPerson, projectPerson } from "./projection";
import { identity } from "./remote";
import { EMAIL_ALREADY_VERIFIED, EMAIL_CODE_EXPIRED, identityFailure, retriedOnce, type IdentityErrorOverrides } from "./remote-errors";
import { isStaffRole } from "./roles";
import { currentSessionToken, type CurrentUser } from "./session";

const t = ru.app.login.email.errors;

/** Предел длины адреса — как emailMax в Go (kzid.go) и emailField в instagram.ts. */
const EMAIL_MAX = 254;
/** Код из письма — ровно 6 цифр (validTotpFormat в Go: иначе invalid_request без траты попытки). */
const CODE_RE = /^\d{6}$/;

/** Адрес-кандидат: без пробелов по краям, в нижнем регистре (normalizeEmail в Go); пустой — не адрес. */
const emailSchema = z
  .string()
  .transform((raw) => raw.trim().toLowerCase())
  .pipe(z.email().max(EMAIL_MAX));

/** Отказ по формату адреса — текст нового экрана у поля email. */
const invalidEmail = (): never => fail.validation(t.invalid, { fieldErrors: { email: [t.invalid] } });

/**
 * email_invalid у RequestEmailCode — текст нового экрана почты, а не прежнего экрана контактов (тот же код у
 * UpdateContacts сопоставлен с ru.identity.contacts в remote-errors.ts). Отказы по коду из письма (неверный, устарел,
 * попытки кончились) remote-errors.ts отдаёт у поля `code`, лимиты — ошибкой формы: эти коды бывают только у почты.
 */
const EMAIL_OVERRIDES: IdentityErrorOverrides = { email_invalid: invalidEmail };

/** Почта — у сторон сделки (заказчик, мастер), как контакты; у сотрудников площадки шага почты нет. */
function requireParty(user: Pick<CurrentUser, "role">): void {
  if (user.role !== "CLIENT" && user.role !== "EXECUTOR") fail.forbidden();
}

/**
 * Шаг почты при входе в новом интерфейсе: стороне сделки нужна подтверждённая почта. Сотрудникам (оператор, замерщик)
 * не нужна — они не стороны договора; сотрудник роль не совмещает (canGrant), но выданные роли проверяются тоже.
 * Почта одна на человека: две роли (заказчик и мастер) подтверждают её один раз.
 */
export function needsEmail(user: Pick<CurrentUser, "role" | "roles" | "emailVerified">): boolean {
  if (isStaffRole(user.role) || user.roles.some(isStaffRole)) return false;
  return !user.emailVerified;
}

/**
 * Итог запроса кода: код выслан (срок и `demoCode` — код, если его вернул identity при мок-провайдере писем) или этот
 * адрес уже подтверждён (identity: email_already_verified) — кода нет, проекция обновлена, экран пропускает шаг почты.
 */
export type EmailCodeRequested = { alreadyVerified: false; expiresAt: Date; demoCode: string | null } | { alreadyVerified: true };

const reasonOf = (e: unknown, reason: string) => e instanceof AppError && e.details?.["reason"] === reason;

/**
 * Личность из identity (GetProfile) в сессии этого браузера — в проекцию: так web узнаёт о подтверждении, сделанном мимо
 * него (другая вкладка, второй одновременный ввод, отставшая проекция). Возвращает, подтверждена ли почта.
 * Сбой GetProfile — ошибка «сервис недоступен» (identityFailure), а не «уже подтверждена»: без обновлённой проекции
 * needsEmail снова вёл бы на шаг почты, а запрос кода снова отвечал бы «уже подтверждена» — шаг зациклился бы.
 */
async function refreshPerson(user: CurrentUser, sessionToken: string): Promise<boolean> {
  let res;
  try {
    res = await identity().getProfile({ sessionToken });
  } catch (e) {
    return identityFailure(e);
  }
  const person = ownPerson(user.id, res.person);
  await projectPerson(person);
  return person.emailVerified;
}

/**
 * Просит identity выслать код на адрес-кандидат. Адрес в профиль не записывается до подтверждения. `demoCode` — только
 * когда его вернул identity (провайдер писем — мок); повтор после обрыва возвращает его пустым. Срок, попытки и лимиты
 * ведёт identity; ключ идемпотентности — здесь, один на оба вызова повтора.
 */
export async function requestEmailCode(user: CurrentUser, email: string): Promise<EmailCodeRequested> {
  requireParty(user);
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) return invalidEmail();
  const sessionToken = await currentSessionToken();
  const request = { sessionToken, email: parsed.data, idempotencyKey: randomUUID() };
  let res;
  try {
    res = await retriedOnce(() => identity().requestEmailCode(request), EMAIL_OVERRIDES);
  } catch (e) {
    if (!reasonOf(e, EMAIL_ALREADY_VERIFIED)) throw e;
    await refreshPerson(user, sessionToken);
    return { alreadyVerified: true };
  }
  if (!res.expiresAt) {
    logger.error("identity.call_rejected", { reason: "request_email_code_without_expiry" });
    return fail.unavailable(ru.common.errors.generic);
  }
  return { alreadyVerified: false, expiresAt: timestampDate(res.expiresAt), demoCode: res.demoCode === "" ? null : res.demoCode };
}

/**
 * Проверяет код в identity: верный — адрес подтверждён, ответ (личность) пишется в проекцию (`email`, `emailVerifiedAt`).
 * Ввод очищается до цифр (вставка «123 456»); не 6 цифр — ошибка поля `code` без вызова identity (попытка не тратится).
 * Неверный, истёкший код, исчерпанные попытки и лимит проверок — ошибки с текстами `ru.app.login.email.errors`.
 * «Код устарел» у человека, чья почта до вызова не была подтверждена, — сначала перечитать личность: если почта уже
 * подтверждена (тот же код погасил второй одновременный ввод, другая вкладка), это успех. У уже подтверждённого
 * (подтверждает новый адрес) «устарел» остаётся отказом: прежнее подтверждение к новому адресу не относится.
 */
export async function verifyEmailCode(user: CurrentUser, code: string): Promise<void> {
  requireParty(user);
  const digits = digitsOnly(code);
  if (!CODE_RE.test(digits)) return fail.validation(t.codeFormat, { fieldErrors: { code: [t.codeFormat] } });
  const sessionToken = await currentSessionToken();
  const request = { sessionToken, code: digits, idempotencyKey: randomUUID() };
  let res;
  try {
    res = await retriedOnce(() => identity().verifyEmailCode(request), EMAIL_OVERRIDES);
  } catch (e) {
    if (!user.emailVerified && reasonOf(e, EMAIL_CODE_EXPIRED) && (await refreshPerson(user, sessionToken))) return;
    throw e;
  }
  await projectPerson(ownPerson(user.id, res.person));
}
