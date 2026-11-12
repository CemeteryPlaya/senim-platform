"use server";

import { requireUser } from "@/modules/identity";
import { acceptPrice, proposalRefSchema, proposePrice, proposePriceSchema, withdrawPrice } from "@/modules/requests";
import { action } from "@/platform/action";

// Торг по отклику (ТЗ п. 9). Вход — zod-схема модуля, первая строка — роль; что это сторона именно этого отклика,
// проверяет сервис requests (иначе «не найдено»). Сумма приходит в тенге, сервис переводит её в тиыны.

export const proposePriceAction = action("requests.proposePrice", proposePriceSchema, async (input) => {
  const user = await requireUser("CLIENT", "EXECUTOR");
  return proposePrice(user, input);
});

export const acceptPriceAction = action("requests.acceptPrice", proposalRefSchema, async (input) => {
  const user = await requireUser("CLIENT", "EXECUTOR");
  return acceptPrice(user, input);
});

export const withdrawPriceAction = action("requests.withdrawPrice", proposalRefSchema, async (input) => {
  const user = await requireUser("CLIENT", "EXECUTOR");
  await withdrawPrice(user, input);
});
