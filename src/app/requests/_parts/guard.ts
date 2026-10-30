import "server-only";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser, type CurrentUser } from "@/modules/identity";
import { isAppError } from "@/platform/errors";

/**
 * Вход на экран: гость — на вход с возвратом; чужая роль (или неподтверждённый исполнитель) — null,
 * экран показывает «нет доступа». Права на конкретные данные проверяет сервис requests.
 */
export async function pageUser(role: "CLIENT" | "EXECUTOR", path: string): Promise<CurrentUser | null> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(path)}`);
  if (user.role !== role) return null;
  if (role === "EXECUTOR" && user.executor?.status !== "APPROVED") return null;
  return user;
}

/** Чужая или несуществующая запись — 404 (сервис отвечает NOT_FOUND и на попытку IDOR). */
export async function orNotFound<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (e) {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  }
}
