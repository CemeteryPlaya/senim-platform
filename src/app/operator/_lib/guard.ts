import "server-only";
import { notFound, redirect } from "next/navigation";
import { requireUser, type CurrentUser } from "@/modules/identity";
import { isAppError } from "@/platform/errors";

/**
 * Первая строка каждой страницы /operator/**: requireUser("OPERATOR").
 * Гость уходит на вход, чужая роль получает 404 — панель не выдаёт, что она существует.
 */
export async function requireOperatorPage(): Promise<CurrentUser> {
  try {
    return await requireUser("OPERATOR");
  } catch (e) {
    if (isAppError(e) && e.code === "UNAUTHENTICATED") redirect("/login");
    if (isAppError(e) && e.code === "FORBIDDEN") notFound();
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
