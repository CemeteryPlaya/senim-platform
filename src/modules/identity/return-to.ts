import type { Role } from "@/generated/prisma/enums";

export const LOGIN_PATH = "/login";
export const EXECUTOR_REGISTRATION_PATH = "/register/executor";

const CONTROL_OR_BACKSLASH = /[\p{Cc}\\]/u;
const SAME_ORIGIN = "http://x";

/** Значение после раскодирования %XX; битая кодировка — null. */
function decoded(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * Адрес возврата после входа: только путь внутри сайта (защита от открытого редиректа).
 * Браузер выбрасывает из адреса табуляцию и переводы строк, а `\` читает как `/`,
 * поэтому `/\t/evil.example` превратился бы в `//evil.example`. Отклоняем управляющие
 * символы и `\` (в том числе закодированные), а оставшееся проверяем разбором URL.
 */
export function safeReturnTo(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return null;
  const plain = decoded(value);
  if (plain === null || CONTROL_OR_BACKSLASH.test(value) || CONTROL_OR_BACKSLASH.test(plain)) return null;
  return new URL(value, SAME_ORIGIN).origin === SAME_ORIGIN ? value : null;
}

/** Ссылка на вход с возвратом; reason=role — «эта страница для другой роли». */
export function loginHref(returnTo: string, reason?: "role"): string {
  const next = safeReturnTo(returnTo);
  if (!next) return LOGIN_PATH;
  const params = new URLSearchParams({ next });
  if (reason) params.set("reason", reason);
  return `${LOGIN_PATH}?${params}`;
}

/** Куда вести после входа, если адреса возврата нет. Маршруты — по таблице владения фазы B. */
export function homePathFor(user: { role: Role; executor: { status: string } | null }): string {
  switch (user.role) {
    case "CLIENT":
      return "/requests";
    case "OPERATOR":
      return "/operator";
    case "MEASURER":
      return "/measurer";
    case "EXECUTOR":
      return user.executor?.status === "APPROVED" ? "/executor/requests" : EXECUTOR_REGISTRATION_PATH;
  }
}
