import type { Role } from "@/generated/prisma/enums";
import { safeReturnTo } from "./return-to";

/**
 * Несколько ролей у одного пользователя (ADR-004). Чистые правила без БД:
 * выданные роли (User.roles), роль по умолчанию (User.role) и активная роль сессии (Session.activeRole).
 */

export const SWITCH_ROLE_PATH = "/switch-role";

/** Роли, которые человек может выбрать в переключателе. */
export const SWITCHABLE_ROLES = ["CLIENT", "EXECUTOR"] as const satisfies readonly Role[];

/**
 * Активная роль: выбранная в сессии, если она всё ещё выдана; иначе роль по умолчанию.
 * Отозванная роль не действует, даже если сессия её помнит.
 */
export function activeRoleOf(granted: readonly Role[], defaultRole: Role, sessionRole: Role | null): Role {
  return sessionRole !== null && granted.includes(sessionRole) ? sessionRole : defaultRole;
}

/** Сотрудники площадки (оператор, замерщик — ADR-004, ADR-005): роль не совмещается с другими. */
export const STAFF_ROLES = ["OPERATOR", "MEASURER"] as const satisfies readonly Role[];
export const isStaffRole = (role: Role): boolean => (STAFF_ROLES as readonly Role[]).includes(role);

/** Можно ли выдать роль: ещё не выдана, и сотрудник площадки не совмещает роль с другими. */
export function canGrant(granted: readonly Role[], role: Role): boolean {
  if (granted.includes(role)) return false;
  return !isStaffRole(role) && !granted.some(isStaffRole);
}

/**
 * Страница требует одну из ролей `required`. Если активная роль не подходит, но подходящая у человека есть, —
 * в какую роль переключиться. null — переключение не нужно (роль подходит) или не поможет (роли нет).
 */
export function roleToSwitch(user: { role: Role; roles: readonly Role[] }, required: readonly Role[]): Role | null {
  if (required.length === 0 || required.includes(user.role)) return null;
  return required.find((r) => user.roles.includes(r)) ?? null;
}

/** Страница переключения роли с возвратом (returnTo — только путь внутри сайта). */
export function switchRoleHref(to: Role, returnTo?: string): string {
  const params = new URLSearchParams({ to });
  const back = safeReturnTo(returnTo);
  if (back) params.set("returnTo", back);
  return `${SWITCH_ROLE_PATH}?${params}`;
}

/** Куда можно переключиться из активной роли: выданные роли переключателя, кроме активной. Одна роль — пусто. */
export function switchTargets(user: { role: Role; roles: readonly Role[] }): (typeof SWITCHABLE_ROLES)[number][] {
  return SWITCHABLE_ROLES.filter((r) => r !== user.role && user.roles.includes(r));
}

/** Разбор параметра `to` страницы переключения: только роль, которую можно выбрать. */
export function parseSwitchableRole(value: unknown): (typeof SWITCHABLE_ROLES)[number] | null {
  return SWITCHABLE_ROLES.find((r) => r === value) ?? null;
}
