import "server-only";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser, type CurrentUser } from "@/modules/identity";

/**
 * Для страниц исполнителя (/executor/profile, /executor/portfolio): гость уходит на вход с возвратом,
 * чужая роль получает 404 (раздел для неё не существует).
 * INTEGRATOR: заменить на identity.requireUserPage(returnTo, "EXECUTOR"), когда он появится в main.
 */
export async function requireExecutorPage(returnTo: string): Promise<CurrentUser & { executor: NonNullable<CurrentUser["executor"]> }> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  if (user.role !== "EXECUTOR" || !user.executor) notFound();
  return { ...user, executor: user.executor };
}
