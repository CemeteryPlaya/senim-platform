import type { Role } from "@/generated/prisma/enums";

export const LOGIN_PATH = "/login";
export const EXECUTOR_REGISTRATION_PATH = "/register/executor";

/** Адрес возврата после входа: только путь внутри сайта (защита от открытого редиректа). */
export function safeReturnTo(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/")) return null;
  if (value.startsWith("//") || value.startsWith("/\\")) return null;
  return value;
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
    case "EXECUTOR":
      return user.executor?.status === "APPROVED" ? "/executor/requests" : EXECUTOR_REGISTRATION_PATH;
  }
}
