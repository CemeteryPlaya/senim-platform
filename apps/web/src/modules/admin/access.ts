import type { CurrentUser } from "@/modules/identity";
import { fail } from "@/platform/errors";

/**
 * Первая строка каждой функции админки — даже если экран и действие уже вызвали requireUser("ADMIN"): модуль не
 * доверяет вызывающему. Роль — раньше второго фактора: оператору без кода отвечают «нет прав», а не «введите код».
 * Второй фактор обязателен администратору всегда — и если identity по ошибке не потребовала его для сессии.
 */
export function assertAdmin(user: CurrentUser): void {
  if (user.role !== "ADMIN") fail.forbidden();
  if (user.mfa.verifiedAt === null) fail.mfaRequired();
}
