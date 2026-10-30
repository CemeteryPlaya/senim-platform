import { fail } from "@/platform/errors";
import type { PaymentRail } from "../rail";

const notConnected = (): never => fail.unavailable("Эскроу-счёт банка-партнёра ещё не подключён");

/**
 * Эскроу банка-партнёра. Только контракт: API банка появится после соглашения.
 * Требования к API — docs/bank/03-escrow-integration.md, вебхуки — docs/bank/openapi.yaml.
 */
export const bankRail: PaymentRail = {
  mode: "bank",
  requiresDeposit: true,
  openAccount: async () => notConnected(),
  getRequisites: async () => notConnected(),
  releaseTranche: async () => notConnected(),
  refund: async () => notConnected(),
  getStatement: async () => notConnected(),
  parseWebhook: async () => notConnected(),
};
