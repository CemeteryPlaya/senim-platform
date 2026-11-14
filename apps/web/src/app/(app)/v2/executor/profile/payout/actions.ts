"use server";

import { requireUser, setPayoutIban } from "@/modules/identity";
import { assertPayoutIbanChangeable } from "@/modules/payments";
import { action } from "@/platform/action";
import { payoutFailure } from "../_parts/errors";
import { payoutSchema } from "./payout-view";

/**
 * Счёт для оплаты: свой профиль из сессии. Схема проверяет формат и контрольную сумму (правила модуля, тексты v2),
 * затем `requireUser`. Порядок как в v1: сначала запрет смены, пока банк проводит оплату (`assertPayoutIbanChangeable`,
 * identity от payments не зависит), потом `setPayoutIban`. В ответе — только последние 4 знака: полный номер на экран
 * не возвращается, в журнал и в тексты ошибок не попадает.
 */
export const savePayoutAction = action("app.executor.savePayout", payoutSchema, async ({ iban }) => {
  const user = await requireUser("EXECUTOR");
  try {
    await assertPayoutIbanChangeable(user);
    const saved = await setPayoutIban(user, { iban });
    return { last4: saved.last4 };
  } catch (e) {
    throw payoutFailure(e);
  }
});
