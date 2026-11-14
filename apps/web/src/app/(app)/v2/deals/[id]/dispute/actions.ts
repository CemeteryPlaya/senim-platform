"use server";

import { z } from "zod";
import { DisputeReason } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { disputePositionSchema, openDispute, openDisputeSchema, submitDisputePosition } from "@/modules/deal-core";
import { requireUser } from "@/modules/identity";
import { action } from "@/platform/action";

const e = ru.app.deal.dispute.form.errors;

// Действия экрана спора покупателя (v2): схема zod, затем `requireUser("CLIENT")` первой строкой. Права на сделку,
// допустимость открытия, «один открытый спор на сделку» (повтор и двойное нажатие — CONFLICT) и приостановку выплаты
// проверяет и делает модуль.

/** Схема модуля; причина вне списка — русский текст у поля. */
const openSchema = openDisputeSchema.extend({ reason: z.enum(DisputeReason, e.reason) });

/** «Открыть спор»: спор, фото и приостановка выплаты (запись FREEZE в журнале) — в одной транзакции модуля. */
export const openDisputeAction = action("app.deal.openDispute", openSchema, async (input) => {
  const user = await requireUser("CLIENT");
  return openDispute(user, input);
});

/** «Отправить позицию» по открытому спору (своя сторона). */
export const submitPositionAction = action("app.deal.disputePosition", disputePositionSchema, async (input) => {
  const user = await requireUser("CLIENT");
  await submitDisputePosition(user, input);
});
