"use server";

import { z } from "zod";
import { requireUser, setPayoutIban } from "@/modules/identity";
import { assertPayoutIbanChangeable } from "@/modules/payments";
import { action } from "@/platform/action";

/**
 * Счёт для выплаты: свой профиль из сессии. Формат и контрольную сумму проверяет identity (ibanField);
 * пока ждёт выплата (SPLIT_MASTER в PENDING), смена запрещена — правило payments, identity от payments не зависит.
 */
export const savePayoutIban = action("identity.setPayoutIban", z.object({ iban: z.string().max(64) }), async (input) => {
  const user = await requireUser("EXECUTOR");
  await assertPayoutIbanChangeable(user);
  return setPayoutIban(user, input);
});
