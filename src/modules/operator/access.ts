import { ru } from "@/i18n/ru";
import type { CurrentUser } from "@/modules/identity";
import { env } from "@/platform/env";
import { fail } from "@/platform/errors";

/**
 * Каждая функция сервиса оператора начинает с этой проверки — даже если экран
 * уже вызвал requireUser("OPERATOR"): сервис не доверяет вызывающему.
 */
export function assertOperator(user: CurrentUser): void {
  if (user.role !== "OPERATOR") fail.forbidden();
}

/** «Сбросить демо», переключатель режима оплаты и показ банку существуют только при DEMO_MODE. */
export function assertDemoMode(): void {
  if (!env().DEMO_MODE) fail.forbidden(ru.operator.errors.demoOnly);
}

export function isDemoMode(): boolean {
  return env().DEMO_MODE;
}
