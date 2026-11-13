"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { ru } from "@/i18n/ru";
import { formatPhone, getCurrentUser, requestOtp, verifyOtp } from "@/modules/identity";
import { action } from "@/platform/action";
import { digitsOnly } from "@/platform/digits";
import { AppError, fail } from "@/platform/errors";
import { nextStepFor, safeNext } from "../../_shell/auth";
import { clientInfo } from "../../_shell/client-info";
import { forgetRole, recallRole, rememberRole } from "../../_shell/role-cookie";
import { LOGIN_ROLES, loginStepHref } from "./steps";

// Вход — действия гостя: requireUser здесь не нужен (сессии ещё нет); защита — лимиты и попытки в identity, а номер и
// код в журнал не пишутся (identity и логгер их не получают от этих действий). Тексты отказов identity — общие
// (ru.identity.otp.errors через remote-errors.ts); здесь они только раскладываются: неверный код и устаревший код — у поля,
// лимиты — общей ошибкой формы.

const t = ru.app.login;

/** Адрес возврата из формы: пустая строка — нет возврата; проверяет его safeNext. */
const nextField = z.string().max(2000).optional();
const phoneField = z.string().trim().min(1, t.phone.errors.required).max(40);

/**
 * Отказ проверки (VALIDATION) — к полю `field`: экран показывает его под полем. Лимиты (RATE_LIMITED), блокировка и
 * недоступность остаются общей ошибкой формы.
 */
function atField(e: unknown, field: string): unknown {
  if (!(e instanceof AppError) || e.code !== "VALIDATION") return e;
  return new AppError(e.code, e.message, { ...e.details, fieldErrors: { [field]: [e.message] } });
}

/** Шаг 1: что человек хочет сделать. Выбор — в подписанной cookie на 30 минут; дальше — шаг номера. */
export const chooseRoleAction = action(
  "app.login.chooseRole",
  z.strictObject({ role: z.enum(LOGIN_ROLES, { error: t.role.errors.required }), next: nextField }),
  async ({ role, next }) => {
    await rememberRole(role === "executor" ? "EXECUTOR" : "CLIENT");
    redirect(loginStepHref("phone", safeNext(next)));
  },
);

/**
 * Шаг 2 и «Отправить ещё раз»: код на номер. Ответ одинаков для нового и известного номера — экран не выдаёт, есть ли
 * у номера аккаунт. `demoCode` — код, если identity работает с заглушкой SMS (экран показывает его вместо сообщения).
 */
export const requestCodeAction = action("app.login.requestCode", z.strictObject({ phone: phoneField }), async ({ phone }) => {
  const { ip } = await clientInfo();
  try {
    const sent = await requestOtp({ phone, ip });
    return { phone: formatPhone(sent.phone), expiresAt: sent.expiresAt.toISOString(), demoCode: sent.demoCode };
  } catch (e) {
    throw atField(e, "phone");
  }
});

/**
 * Шаг 3: проверка кода и начало сессии, затем переход на первый непройденный шаг (согласие, знакомство, почта), `next`
 * или дом. Код — только 6 цифр после удаления пробелов и прочего (`digitsOnly`): иначе ошибка у поля без вызова identity.
 * Выбор роли нужен только новому человеку; у существующего он забывается — тот попадает в свой дом.
 */
export const verifyCodeAction = action(
  "app.login.verifyCode",
  z.strictObject({
    phone: phoneField,
    code: z.string().max(20).transform(digitsOnly).pipe(z.string().length(6, t.code.errors.format)),
    next: nextField,
  }),
  async ({ phone, code, next }) => {
    const { ip, userAgent } = await clientInfo();
    const verified = await verifyOtp({ phone, code, ip, userAgent }).catch((e: unknown) => {
      throw atField(e, "code");
    });
    if (!verified.isNew) await forgetRole();
    const user = await getCurrentUser();
    if (!user) return fail.unavailable(ru.common.errors.generic);
    redirect(nextStepFor(user, safeNext(next), verified.isNew ? await recallRole() : null));
  },
);
