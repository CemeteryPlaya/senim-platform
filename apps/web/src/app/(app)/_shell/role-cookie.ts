import "server-only";
import { cookies } from "next/headers";
import { openValue, sealValue } from "@/platform/crypto";
import { env } from "@/platform/env";

/**
 * Что человек выбрал на первом шаге входа («Заказать мебель» или «Я мастер»). Роли в identity выбор не меняет: новый номер
 * там всегда заказчик, роль мастера выдаётся позже, при регистрации компании. Выбор влияет только на то, куда человек
 * попадёт после первых шагов (nextStepFor): выбравший «Я мастер» без профиля исполнителя — на регистрацию мастера.
 */
export type ChosenRole = "CLIENT" | "EXECUTOR";

/** Срок выбора: от первого шага до конца первых шагов после входа. */
export const ROLE_TTL_MS = 30 * 60_000;

/**
 * Назначение запечатанного значения (AAD): значение другого назначения (`sealValue` с другим контекстом) здесь не
 * открывается, и наоборот.
 */
const CONTEXT = "app.login.role.v1";

/**
 * Значение cookie: «роль.срок» (срок — миллисекунды Unix), запечатанное `sealValue` (AES-256-GCM ключом, выведенным из
 * PII_ENCRYPTION_KEY: тот же серверный секрет, что у других значений, которые уходят в браузер и возвращаются; новой
 * переменной окружения не нужно). Тег GCM — подпись: изменённое, обрезанное или чужое значение не открывается
 * (сравнение тега — в OpenSSL, за постоянное время).
 */
export function sealRole(role: ChosenRole, now: number = Date.now()): string {
  return sealValue(`${role}.${now + ROLE_TTL_MS}`, CONTEXT);
}

/** Роль из значения cookie; подделка, чужой формат или истёкший срок — `null`. */
export function openRole(value: string | undefined, now: number = Date.now()): ChosenRole | null {
  if (!value) return null;
  let plain: string;
  try {
    plain = openValue(value, CONTEXT);
  } catch {
    return null;
  }
  const match = /^(CLIENT|EXECUTOR)\.(\d{1,15})$/.exec(plain);
  if (!match) return null;
  return Number(match[2]) > now ? (match[1] as ChosenRole) : null;
}

/**
 * Имя cookie: `__Host-` вне dev (только Secure, Path=/, без Domain — как у cookie сессии, session-cookie.ts); в dev по
 * http — без префикса, иначе браузер её не примет.
 */
export function roleCookieName(): string {
  return env().APP_ENV === "dev" ? "senim_login_role" : "__Host-senim_login_role";
}

/**
 * Параметры cookie. Path — «/»: префикс `__Host-` требует ровно его (узкий путь браузер отверг бы). Значение
 * непрозрачно и само несёт срок; Max-Age совпадает с ним.
 */
function roleCookieOptions() {
  return {
    httpOnly: true,
    secure: env().APP_ENV !== "dev",
    sameSite: "lax" as const,
    path: "/",
  };
}

/** Запомнить выбор первого шага (Server Action). */
export async function rememberRole(role: ChosenRole): Promise<void> {
  (await cookies()).set(roleCookieName(), sealRole(role), { ...roleCookieOptions(), maxAge: ROLE_TTL_MS / 1000 });
}

/** Выбор первого шага, если он ещё действует; иначе `null`. Читать можно и в серверном компоненте. */
export async function recallRole(): Promise<ChosenRole | null> {
  return openRole((await cookies()).get(roleCookieName())?.value);
}

/**
 * Забыть выбор: последний из первых шагов после входа (почта), вход существующего человека и выход. Удаление — с теми же
 * Secure/Path/SameSite, что при установке: иначе браузер не удалит `__Host-` cookie. Только в Server Action.
 */
export async function forgetRole(): Promise<void> {
  (await cookies()).delete({ name: roleCookieName(), ...roleCookieOptions() });
}
