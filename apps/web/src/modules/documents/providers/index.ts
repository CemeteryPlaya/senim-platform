import { ru } from "@/i18n/ru";
import { env } from "@/platform/env";
import { fail } from "@/platform/errors";
import type { SignatureProvider } from "../signature";
import { mockSignatureProvider } from "./mock-signature";

/** Провайдер подписи по SIGNATURE_PROVIDER. SIGEX — скелет без вызовов API (см. ./sigex.ts). */
export function signatureProvider(): SignatureProvider {
  switch (env().SIGNATURE_PROVIDER) {
    case "mock":
      return mockSignatureProvider;
    case "sigex":
      return fail.unavailable(ru.documents.errors.sigexUnavailable);
  }
}
