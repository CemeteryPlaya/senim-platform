"use server";

import { z } from "zod";
import { requireUser, setPayoutIban } from "@/modules/identity";
import { action } from "@/platform/action";

/** Счёт для выплаты: свой профиль из сессии. Формат и контрольную сумму проверяет identity (ibanField). */
export const savePayoutIban = action("identity.setPayoutIban", z.object({ iban: z.string().max(64) }), async (input) => {
  const user = await requireUser("EXECUTOR");
  return setPayoutIban(user, input);
});
