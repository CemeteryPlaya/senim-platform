import { ru } from "@/i18n/ru";
import type { CurrentUser } from "@/modules/identity";
import { db, type Db } from "@/platform/db";
import { fail } from "@/platform/errors";

/**
 * Ждёт ли мастер выплату: часть SPLIT_MASTER по одной из его сделок в PENDING (распоряжение передано, банк
 * ещё не провёл). Отклонённая выплата (FAILED) не считается: смена неверного счёта и есть способ её исправить,
 * затем оператор повторяет операцию.
 */
export async function hasPendingPayout(executorId: string, client: Db = db): Promise<boolean> {
  const pending = await client.moneyTransaction.count({ where: { type: "SPLIT_MASTER", status: "PENDING", deal: { executorId } } });
  return pending > 0;
}

/**
 * Смену счёта для выплаты, пока ждёт выплата, запрещаем: деньги ушли бы на новый счёт без проверки.
 * Проверка — выше identity (identity не зависит от payments): её вызывает экран счёта перед identity.setPayoutIban.
 */
export async function assertPayoutIbanChangeable(user: CurrentUser): Promise<void> {
  if (!user.executor) return;
  if (!(await hasPendingPayout(user.executor.id))) return;
  const message = ru.payments.errors.payoutPending;
  fail.validation(message, { fieldErrors: { iban: [message] } });
}
