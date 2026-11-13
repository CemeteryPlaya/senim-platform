"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { ru } from "@/i18n/ru";
import {
  isCodeTooOften,
  isEmailCodeAlreadySent,
  needsEmail,
  requestEmailCode,
  requireUser,
  verifyEmailCode,
  type CurrentUser,
} from "@/modules/identity";
import { action } from "@/platform/action";
import { digitsOnly } from "@/platform/digits";
import { AppError } from "@/platform/errors";
import { nextStepFor, safeNext } from "../../_shell/auth";
import { forgetRole, recallRole } from "../../_shell/role-cookie";

// Почта — последний из первых шагов после входа. Адрес и код в журнал не пишутся (действия ничего не логируют, модуль
// identity логирует причины без адреса); адрес не уходит в адрес страницы. Отказы identity (неверный, устаревший код,
// попытки, лимиты) — тексты ru.app.login.email.errors через remote-errors.ts: по коду — у поля `code`, лимиты — общей
// ошибкой формы.

const t = ru.app.onboarding.email;
const errors = ru.app.login.email.errors;

/** Адрес возврата из формы: пустая строка — нет возврата; проверяет его safeNext. */
const nextField = z.string().max(2000).optional();
/** Формат адреса проверяет модуль (email.ts: та же нормализация, что в identity); здесь — пусто и предел длины. */
const emailField = z.string().trim().min(1, t.errors.required).max(254, errors.invalid);

/**
 * Почта подтверждена — сейчас или раньше (вторая вкладка, отставшая проекция): выбор роли на входе больше не нужен
 * (forgetRole), дальше — `next` или дом с учётом выбора (nextStepFor). Пользователь прочитан до подтверждения (кэш на
 * время запроса), поэтому признак дописывается вручную — иначе шаг вёл бы сам на себя.
 */
async function moveOn(user: CurrentUser, next: string | undefined): Promise<never> {
  const chosen = await recallRole();
  await forgetRole();
  redirect(nextStepFor({ ...user, emailVerified: true }, safeNext(next), chosen));
}

/**
 * «Получить код» и «Отправить ещё раз»: код на адрес-кандидат (в профиль адрес попадёт только после подтверждения).
 * Ответ — адрес в том виде, в каком его принял identity (без пробелов, строчными), и код заглушки писем, если он есть.
 * Почта уже подтверждена — не ошибка, а переход дальше. Повтор нажатия гасит форма; повтор запроса в ту же минуту
 * identity отклоняет — второго кода не бывает. Если действующий код выдан на этот же адрес (email_code_already_sent:
 * человек перезагрузил страницу на шаге кода), экран получает `alreadySent: true` и ведёт на шаг кода; если на другой
 * (email_code_too_often) — ошибка у поля адреса: шаг кода «для этого адреса» был бы неправдой. Лимит в час и в сутки —
 * ошибка, как прежде.
 */
export const requestEmailCodeAction = action(
  "app.email.requestCode",
  z.strictObject({ email: emailField, next: nextField }),
  async ({ email, next }) => {
    const user = await requireUser("CLIENT", "EXECUTOR");
    if (!needsEmail(user)) return moveOn(user, next);
    const address = email.toLowerCase();
    let sent;
    try {
      sent = await requestEmailCode(user, email);
    } catch (e) {
      if (isEmailCodeAlreadySent(e)) return { email: address, demoCode: null, alreadySent: true };
      if (isCodeTooOften(e)) throw new AppError("RATE_LIMITED", t.errors.otherAddress, { fieldErrors: { email: [t.errors.otherAddress] } });
      throw e;
    }
    if (sent.alreadyVerified) return moveOn(user, next);
    return { email: address, demoCode: sent.demoCode, alreadySent: false };
  },
);

/**
 * «Подтвердить»: код из письма — только 6 цифр после удаления пробелов и прочего (`digitsOnly`), иначе ошибка у поля без
 * вызова identity (попытка не тратится). `email` — адрес, показанный на шаге кода (скрытое поле формы): identity
 * подтверждает ровно его; код, выданный на другой адрес, — «код устарел». Верный код — почта подтверждена, дальше `next`
 * или дом. Повтор того же кода после успеха (вторая вкладка) — тоже дальше: шаг уже пройден (needsEmail), identity не
 * вызывается.
 */
export const verifyEmailCodeAction = action(
  "app.email.verifyCode",
  z.strictObject({
    code: z.string().max(20).transform(digitsOnly).pipe(z.string().length(6, errors.codeFormat)),
    email: emailField,
    next: nextField,
  }),
  async ({ code, email, next }) => {
    const user = await requireUser("CLIENT", "EXECUTOR");
    if (needsEmail(user)) await verifyEmailCode(user, code, email);
    return moveOn(user, next);
  },
);
