import { ru } from "@/i18n/ru";
import { fail } from "@/platform/errors";
import type { PaymentRail } from "../rail";

const notApplicable = (): never => fail.conflict(ru.payments.errors.manualNoAccount);

/** Прямая оплата исполнителю. Денежных операций нет — только отметки сторон в deal-core. */
export const manualRail: PaymentRail = {
  mode: "manual",
  requiresDeposit: false,
  openAccount: async () => notApplicable(),
  getRequisites: async () => notApplicable(),
  releaseTranche: async () => notApplicable(),
  refund: async () => notApplicable(),
  getStatement: async () => [],
  parseWebhook: async () => notApplicable(),
};
