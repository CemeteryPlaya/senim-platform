"use server";

import { handleRailWebhook } from "@/modules/deal-core";
import { requireUser } from "@/modules/identity";
import { simulatorAccountSchema, simulatorDeposit, simulatorDepositSchema, simulatorRedeliver, type SignedDelivery } from "@/modules/payments";
import { action } from "@/platform/action";

/**
 * Банк-симулятор. «Банк» зачисляет деньги и доставляет платформе подписанный вебхук —
 * тем же обработчиком, что и маршрут /api/webhooks/escrow-simulator (проверка HMAC, дедупликация события).
 */
const deliver = (d: SignedDelivery) => handleRailWebhook("escrow-simulator", { headers: new Headers(d.headers), rawBody: d.rawBody });

export const depositAction = action("payments.simulatorDeposit", simulatorDepositSchema, async (input) => {
  const user = await requireUser("CLIENT");
  const outcome = await deliver(await simulatorDeposit(user, input));
  return { duplicate: outcome.duplicate };
});

export const redeliverAction = action("payments.simulatorRedeliver", simulatorAccountSchema, async (input) => {
  const user = await requireUser("CLIENT", "EXECUTOR", "OPERATOR");
  const delivery = await simulatorRedeliver(user, input);
  if (!delivery) return { duplicate: false };
  const outcome = await deliver(delivery);
  return { duplicate: outcome.duplicate };
});
