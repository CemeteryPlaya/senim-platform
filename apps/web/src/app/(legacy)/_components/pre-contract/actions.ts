"use server";

import { requireUser } from "@/modules/identity";
import {
  allowOfferRetry,
  allowOfferRetrySchema,
  approveProject,
  assignSiteMeasurer,
  assignSiteMeasurerSchema,
  completeSiteMeasurement,
  completeSiteMeasurementSchema,
  confirmDeposit,
  depositRefSchema,
  markDepositPaid,
  projectRefSchema,
  requestProjectChanges,
  requestProjectChangesSchema,
  setPreContractFlow,
  setPreContractFlowSchema,
  submitProject,
  submitProjectSchema,
} from "@/modules/requests";
import { action } from "@/platform/action";

// Действия шагов до договора (ADR-005). Вход — zod-схема модуля, первая строка — роль;
// права на конкретную заявку, отклик и проект проверяет сервис requests.

export const submitProjectAction = action("requests.submitProject", submitProjectSchema, async (input) => {
  const user = await requireUser("EXECUTOR");
  return submitProject(user, input);
});

export const approveProjectAction = action("requests.approveProject", projectRefSchema, async (input) => {
  const user = await requireUser("CLIENT");
  await approveProject(user, input);
});

export const requestProjectChangesAction = action("requests.requestProjectChanges", requestProjectChangesSchema, async (input) => {
  const user = await requireUser("CLIENT");
  await requestProjectChanges(user, input);
});

export const markDepositPaidAction = action("requests.markDepositPaid", depositRefSchema, async (input) => {
  const user = await requireUser("CLIENT");
  await markDepositPaid(user, input);
});

export const confirmDepositAction = action("requests.confirmDeposit", depositRefSchema, async (input) => {
  const user = await requireUser("EXECUTOR");
  await confirmDeposit(user, input);
});

export const completeSiteMeasurementAction = action("requests.completeSiteMeasurement", completeSiteMeasurementSchema, async (input) => {
  const user = await requireUser("MEASURER");
  await completeSiteMeasurement(user, input);
});

export const assignSiteMeasurerAction = action("requests.assignSiteMeasurer", assignSiteMeasurerSchema, async (input) => {
  const user = await requireUser("OPERATOR");
  await assignSiteMeasurer(user, input);
});

export const allowOfferRetryAction = action("requests.allowOfferRetry", allowOfferRetrySchema, async (input) => {
  const user = await requireUser("OPERATOR");
  await allowOfferRetry(user, input);
});

export const setPreContractFlowAction = action("requests.setPreContractFlow", setPreContractFlowSchema, async (input) => {
  const user = await requireUser("OPERATOR");
  await setPreContractFlow(user, input);
});
