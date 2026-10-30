import "server-only";
import { env } from "@/platform/env";
import { fail } from "@/platform/errors";
import { mockSignatureProvider } from "./providers/mock-signature";
import type { SignatureProvider } from "./signature";

export type * from "./signature";
// Контракты для deal-core (createContract, createStageAct, completeSigning) — в ./contracts.
export type { CompleteSigning, CreateContract, CreateStageAct, CreatedDocument } from "./contracts";

export function signatureProvider(): SignatureProvider {
  switch (env().SIGNATURE_PROVIDER) {
    case "mock":
      return mockSignatureProvider;
    case "sigex":
      return fail.unavailable("Подпись через SIGEX ещё не подключена");
  }
}

export const jobHandlers = {} as const;
