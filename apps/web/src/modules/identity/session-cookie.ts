import { randomBytes } from "node:crypto";
import { env } from "@/platform/env";

/**
 * Имя cookie сессии: `__Host-` (только Secure, Path=/, без Domain) вне dev; в dev по http — без префикса,
 * иначе браузер его не примет. Читать нужно ТОЛЬКО это имя: cookie другого контура не принимается.
 */
export function sessionCookieName(): string {
  return env().APP_ENV === "dev" ? "senim_session" : "__Host-senim_session";
}

/** Параметры cookie сессии; срок жизни ведёт identity, cookie — сессионная. */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: env().APP_ENV !== "dev",
    sameSite: "lax" as const,
    path: "/",
  };
}

/** Токен сессии, который web генерирует сам: 32 случайных байта, base64url без «=» (43 символа). */
export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}
