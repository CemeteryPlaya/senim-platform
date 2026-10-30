import { executeOperation } from "@/modules/payments";
import type { JobHandlers } from "@/platform/jobs";
import { JOB_AUTO_ACCEPT, JOB_OPEN_ACCOUNT, JOB_SETTLE } from "./effects";
import { dealPayloadSchema, parseInput, settlePayloadSchema } from "./schemas";
import { autoAcceptStage, onPaymentSettled, openEscrowAccount, settleDeal } from "./service";

/** Фоновые задачи deal-core. Все идемпотентны: повтор после сбоя приводит к тому же состоянию. */
export const jobHandlers = {
  /** Автоприёмка сданного этапа по сроку (ставится при сдаче, dedupeKey — этап + время сдачи). */
  [JOB_AUTO_ACCEPT]: async (payload, ctx) => {
    const result = await autoAcceptStage(payload);
    ctx.log.info("auto-accept", { result });
  },
  /** Отправка операции по счёту в банк; сбой банка — исключение, планировщик повторит. */
  [JOB_SETTLE]: async (payload) => {
    const { idempotencyKey } = parseInput(settlePayloadSchema, payload);
    await executeOperation(idempotencyKey, onPaymentSettled);
  },
  /** Открытие счёта сделки после подписи договора в эскроу-режиме. */
  [JOB_OPEN_ACCOUNT]: async (payload) => {
    const { dealId } = parseInput(dealPayloadSchema, payload);
    await openEscrowAccount(dealId);
    await settleDeal(dealId);
  },
} as const satisfies JobHandlers;
