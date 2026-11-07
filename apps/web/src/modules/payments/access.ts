import type { CurrentUser } from "@/modules/identity";
import { fail } from "@/platform/errors";

/** Действия оператора с журналом денег (подтверждение manual, повтор после отказа банка): только OPERATOR. */
export function requireOperator(user: CurrentUser): void {
  if (user.role !== "OPERATOR") fail.forbidden();
}
