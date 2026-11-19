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
import { shellChanged } from "../../_shell/onboarding";
import { to } from "../../_shell/paths";
import { becomingMaster } from "../../_shell/role-choice";
import { forgetRole, recallRole } from "../../_shell/role-cookie";

// Почта — последний из первых шагов после входа. Адрес и код в журнал не пишутся (действия ничего не логируют, модуль
// identity логирует причины без адреса); адрес не уходит в адрес страницы. Отказы identity (неверный, устаревший код,
// попытки, лимиты) — тексты ru.app.login.email.errors через remote-errors.ts: по коду — у поля `code`, лимиты — общей
// ошибкой формы.

const t = ru.app.onboarding.email;
const errors = ru.app.login.email.errors;
const c = ru.app.profile.emailChange;

/** Адрес возврата из формы: пустая строка — нет возврата; проверяет его safeNext. */
const nextField = z.string().max(2000).optional();
/** Смена уже подтверждённой почты (из профиля): "1" — режим смены; всё прочее — обычные первые шаги. */
const changeField = z.string().max(1).optional();
/** Формат адреса проверяет модуль (email.ts: та же нормализация, что в identity); здесь — пусто и предел длины. */
const emailField = z.string().trim().min(1, t.errors.required).max(254, errors.invalid);

/**
 * Почта подтверждена — сейчас или раньше (вторая вкладка, отставшая проекция): выбор роли на входе забывается, кроме того,
 * кто идёт к профилю мастера (`becomingMaster`): ему выбор нужен до отправки анкеты. Дальше — `next` или дом с учётом
 * выбора (nextStepFor). Пользователь прочитан до подтверждения (кэш на время запроса), поэтому признак дописывается
 * вручную — иначе шаг вёл бы сам на себя.
 */
async function moveOn(user: CurrentUser, next: string | undefined): Promise<never> {
  const chosen = await recallRole();
  if (!becomingMaster(user, chosen)) await forgetRole();
  shellChanged();
  redirect(nextStepFor({ ...user, emailVerified: true }, safeNext(next), chosen));
}

/** Контакты профиля после смены почты: тост «Почта изменена» показывает сам экран по `?email=changed`. */
const EMAIL_CHANGED_HREF = `${to("/profile/contacts")}?email=changed`;

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
  z.strictObject({ email: emailField, next: nextField, change: changeField }),
  async ({ email, next, change }) => {
    const user = await requireUser("CLIENT", "EXECUTOR");
    // Смена: почта уже подтверждена, код уходит на новый адрес; прежняя действует, пока новый не подтверждён (identity).
    const changing = change === "1" && !needsEmail(user);
    if (!needsEmail(user) && !changing) return moveOn(user, next);
    const address = email.toLowerCase();
    let sent;
    try {
      sent = await requestEmailCode(user, email);
    } catch (e) {
      if (isEmailCodeAlreadySent(e)) return { email: address, shownCode: null, alreadySent: true };
      if (isCodeTooOften(e)) throw new AppError("RATE_LIMITED", t.errors.otherAddress, { fieldErrors: { email: [t.errors.otherAddress] } });
      throw e;
    }
    if (sent.alreadyVerified) {
      if (changing) throw new AppError("VALIDATION", c.sameAddress, { fieldErrors: { email: [c.sameAddress] } });
      return moveOn(user, next);
    }
    return { email: address, shownCode: sent.shownCode, alreadySent: false };
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
    change: changeField,
  }),
  async ({ code, email, next, change }) => {
    const user = await requireUser("CLIENT", "EXECUTOR");
    // Смена: подтверждается новый адрес (прежняя подтверждённая почта у identity остаётся до успеха), дальше — контакты.
    if (change === "1" && !needsEmail(user)) {
      await verifyEmailCode(user, code, email);
      redirect(EMAIL_CHANGED_HREF);
    }
    if (needsEmail(user)) await verifyEmailCode(user, code, email);
    return moveOn(user, next);
  },
);
