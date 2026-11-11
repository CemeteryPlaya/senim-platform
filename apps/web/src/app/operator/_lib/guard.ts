import "server-only";
import { redirect } from "next/navigation";
import { consentHref, loginHref, mfaHref, requireUser, type CurrentUser } from "@/modules/identity";
import { isAppError } from "@/platform/errors";

/**
 * Первая строка каждой страницы /operator/**: requireUser("OPERATOR").
 * Гость уходит на вход с возвратом, чужая роль — на вход с пояснением «страница для другой роли»,
 * оператор без второй ступени (вошёл только по SMS) — на /operator/mfa с возвратом.
 */
export async function requireOperatorPage(returnTo: string): Promise<CurrentUser> {
  try {
    return await requireUser("OPERATOR");
  } catch (e) {
    if (isAppError(e) && e.code === "UNAUTHENTICATED") redirect(loginHref(returnTo));
    if (isAppError(e) && e.code === "FORBIDDEN") redirect(loginHref(returnTo, "role"));
    if (isAppError(e) && e.code === "MFA_REQUIRED") redirect(mfaHref(returnTo));
    if (isAppError(e) && e.code === "CONSENT_REQUIRED") redirect(consentHref(returnTo));
    throw e;
  }
}

/** Значение searchParams как одна строка (повтор параметра — первое значение). */
export function param(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Все параметры строки запроса как плоский объект для zod-схемы. */
export function flatParams(sp: Record<string, string | string[] | undefined>): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, param(v)]));
}
