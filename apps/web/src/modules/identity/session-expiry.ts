import type { ActionResult } from "@/platform/action";
import { consentHref, loginHref } from "./return-to";

/** Где человек сейчас и как увести его со страницы (в браузере — `window.location`). */
export type Here = Pick<Location, "pathname" | "search" | "assign">;

/**
 * Сессия истекла посреди формы (30 мин простоя): Server Action вернул UNAUTHENTICATED — уводим на вход с возвратом на этот
 * же экран. CONSENT_REQUIRED (сменилась редакция согласия или отзыв исполнен) — на экран согласия с тем же возвратом.
 * true — ушли, форме дальше ничего делать не нужно.
 */
export function leaveIfSignedOut(result: ActionResult<unknown>, here: Here = window.location): boolean {
  if (result.ok) return false;
  const back = here.pathname + here.search;
  if (result.code === "UNAUTHENTICATED") here.assign(loginHref(back));
  else if (result.code === "CONSENT_REQUIRED") here.assign(consentHref(back));
  else return false;
  return true;
}

/**
 * Действие оператора вернуло MFA_REQUIRED: второй фактор не пройден или пройден давно (перед деньгами —
 * MFA_STEP_UP_WINDOW). Форма просит код из приложения (`ask` — с текстом сервера) и повторяет действие с ним.
 * true — спросили, обычная ошибка не нужна.
 */
export function askSecondFactor(result: ActionResult<unknown>, ask: (message: string) => void): boolean {
  if (result.ok || result.code !== "MFA_REQUIRED") return false;
  ask(result.error);
  return true;
}
