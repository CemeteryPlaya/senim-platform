import { fail } from "@/platform/errors";
import type { CurrentUser } from "./session";

/**
 * Свой профиль исполнителя из сессии: id в запросе нет, поэтому чужой профиль не задать (IDOR невозможен).
 * Не исполнитель или без профиля — FORBIDDEN.
 */
export function ownExecutorId(user: CurrentUser): string {
  if (user.role !== "EXECUTOR" || !user.executor) return fail.forbidden();
  return user.executor.id;
}
