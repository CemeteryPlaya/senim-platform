"use server";

import {
  acceptStage,
  cancelDeal,
  cancelDealSchema,
  confirmStagePayment,
  disputePositionSchema,
  leaveReview,
  markStagePaid,
  openDispute,
  openDisputeSchema,
  requestRework,
  reviewSchema,
  reworkSchema,
  stageRefSchema,
  startStage,
  submitDisputePosition,
  submitStage,
  submitStageSchema,
} from "@/modules/deal-core";
import { requireUser } from "@/modules/identity";
import { action } from "@/platform/action";

// Действия на экране сделки. Вход — zod-схема deal-core, первая строка — роль;
// принадлежность сделки и допустимость перехода проверяет сервис (IDOR → «не найдено»).

export const startStageAction = action("deal.startStage", stageRefSchema, async (input) => {
  const user = await requireUser("EXECUTOR");
  await startStage(user, input);
});

export const submitStageAction = action("deal.submitStage", submitStageSchema, async (input) => {
  const user = await requireUser("EXECUTOR");
  await submitStage(user, input);
});

export const acceptStageAction = action("deal.acceptStage", stageRefSchema, async (input) => {
  const user = await requireUser("CLIENT");
  await acceptStage(user, input);
});

export const reworkAction = action("deal.requestRework", reworkSchema, async (input) => {
  const user = await requireUser("CLIENT");
  await requestRework(user, input);
});

export const markPaidAction = action("deal.markStagePaid", stageRefSchema, async (input) => {
  const user = await requireUser("CLIENT");
  await markStagePaid(user, input);
});

export const confirmPaymentAction = action("deal.confirmStagePayment", stageRefSchema, async (input) => {
  const user = await requireUser("EXECUTOR");
  await confirmStagePayment(user, input);
});

export const cancelDealAction = action("deal.cancel", cancelDealSchema, async (input) => {
  const user = await requireUser("CLIENT", "EXECUTOR");
  await cancelDeal(user, input);
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
