import type { CurrentUser } from "@/modules/identity";
import { fail } from "@/platform/errors";

/**
 * Каждая функция сервиса оператора начинает с этой проверки — даже если экран
 * уже вызвал requireUser("OPERATOR"): сервис не доверяет вызывающему.
 */
export function assertOperator(user: CurrentUser): void {
  if (user.role !== "OPERATOR") fail.forbidden();
}
