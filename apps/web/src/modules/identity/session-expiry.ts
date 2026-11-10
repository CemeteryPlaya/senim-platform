import type { ActionResult } from "@/platform/action";
import { loginHref } from "./return-to";

/** Где человек сейчас и как увести его со страницы (в браузере — `window.location`). */
export type Here = Pick<Location, "pathname" | "search" | "assign">;

/**
 * Сессия истекла посреди формы (30 мин простоя): Server Action вернул UNAUTHENTICATED.
 * Уводим на вход с возвратом на этот же экран. true — ушли, форме дальше ничего делать не нужно.
 */
export function leaveIfSignedOut(result: ActionResult<unknown>, here: Here = window.location): boolean {
  if (result.ok || result.code !== "UNAUTHENTICATED") return false;
  here.assign(loginHref(here.pathname + here.search));
  return true;
}
