"use server";

import {
  addProgressReport,
  giveBankConsent,
  cancelDeal,
  cancelDealSchema,
  dealRefSchema,
  disputePositionSchema,
  leaveReview,
  openDispute,
  openDisputeSchema,
  payForDeal,
  progressReportSchema,
  reviewSchema,
  startWork,
  submitDisputePosition,
  submitReady,
  submitReadySchema,
} from "@/modules/deal-core";
import { requireUser } from "@/modules/identity";
import { action } from "@/platform/action";

// Действия на экране сделки (ТЗ п. 9). Вход — zod-схема deal-core, первая строка — роль; принадлежность сделки,
// допустимость перехода и двойной клик проверяет сервис (IDOR → «не найдено», повтор — та же операция).

/** Оплата: mock — сразу под защитой банка; manual — «Оплата в обработке»; провайдер со страницей — redirectUrl. */
export const payAction = action("deal.pay", dealRefSchema, async (input) => {
  const user = await requireUser("CLIENT");
  const { status, redirectUrl } = await payForDeal(user, input);
  return { status, redirectUrl };
});

/** Отметка «Передача данных банку-партнёру» стороны сделки: мастер — до подписи оферты, покупатель — перед оплатой. */
export const bankConsentAction = action("deal.bankConsent", dealRefSchema, async (input) => {
  const user = await requireUser("CLIENT", "EXECUTOR");
  await giveBankConsent(user, input);
});

export const startWorkAction = action("deal.startWork", dealRefSchema, async (input) => {
  const user = await requireUser("EXECUTOR");
  await startWork(user, input);
});

/** Сдача: фото обязательно; GPS — мягкая проверка, ответ с расстоянием для предупреждения. */
export const submitReadyAction = action("deal.submitReady", submitReadySchema, async (input) => {
  const user = await requireUser("EXECUTOR");
  return submitReady(user, input);
});

export const progressReportAction = action("deal.progressReport", progressReportSchema, async (input) => {
  const user = await requireUser("EXECUTOR");
  await addProgressReport(user, input);
});

/** Отмена: до оплаты — любая сторона; после оплаты — покупатель (возврат на карту); дальше — только спор. */
export const cancelDealAction = action("deal.cancel", cancelDealSchema, async (input) => {
  const user = await requireUser("CLIENT", "EXECUTOR");
  return cancelDeal(user, input);
});

export const openDisputeAction = action("deal.openDispute", openDisputeSchema, async (input) => {
  const user = await requireUser("CLIENT", "EXECUTOR");
  await openDispute(user, input);
});

export const disputePositionAction = action("deal.disputePosition", disputePositionSchema, async (input) => {
  const user = await requireUser("CLIENT", "EXECUTOR");
  await submitDisputePosition(user, input);
});

export const reviewAction = action("deal.review", reviewSchema, async (input) => {
  const user = await requireUser("CLIENT");
  await leaveReview(user, input);
});
