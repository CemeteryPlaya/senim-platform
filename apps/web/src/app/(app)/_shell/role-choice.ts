import type { StepUser } from "./auth";
import type { ChosenRole } from "./role-cookie";

/**
 * Правила выбора «Заказать мебель» / «Я мастер» с первого шага входа (спека «Гибридный онбординг мастера»). Чистые
 * функции: выбор (`recallRole()`) и пользователя передаёт вызывающий.
 */

/**
 * Человек идёт к профилю мастера: выбрал «Я мастер», активна роль заказчика и профиля мастера ещё нет. Пока это так,
 * `/v2` ведёт на анкету мастера, а оболочка показывает вкладки неодобренного мастера без «Заказать мебель».
 */
export function becomingMaster(user: Pick<StepUser, "role" | "executor">, chosen: ChosenRole | null): boolean {
  return chosen === "EXECUTOR" && user.role === "CLIENT" && user.executor === null;
}

/** Что делать с выбором при входе известного номера. */
export type LoginChoice = {
  /** Выбор нужен дальше (человек идёт к профилю мастера); иначе его забывают. */
  keep: boolean;
  /** Выданная, но не активная роль, на которую указывает выбор; `null` — переключать не нужно. */
  switchTo: ChosenRole | null;
};

/**
 * Выбор первого шага для номера, который identity уже знает. Оператор и замерщик — выбор игнорируется и забывается.
 * Выбор указывает на выданную, но не активную роль — переключение на неё, выбор забывается (в обе стороны). Заказчик без
 * профиля мастера выбрал «Я мастер» — выбор живёт дальше, путь как у новичка. Прочее — выбор забывается, роль та же:
 * вход ролей не выдаёт.
 */
export function loginChoice(user: Pick<StepUser, "role" | "roles" | "executor">, chosen: ChosenRole | null): LoginChoice {
  if (chosen === null || (user.role !== "CLIENT" && user.role !== "EXECUTOR")) return { keep: false, switchTo: null };
  if (chosen !== user.role && user.roles.includes(chosen)) return { keep: false, switchTo: chosen };
  return { keep: becomingMaster(user, chosen), switchTo: null };
}
