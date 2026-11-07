import type { PaymentProviderKind } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { env, resolvePaymentProvider, type Env } from "@/platform/env";
import { fail } from "@/platform/errors";
import type { PaymentProvider, PaymentProviderName } from "../provider";
import { createFreedomPayProvider } from "./freedompay";
import { manualProvider } from "./manual";
import { mockProvider } from "./mock";

/**
 * Реестр провайдеров. Провайдер сделки фиксируется при создании (Deal.paymentProvider), поэтому операции
 * сделки идут через её провайдера, даже если PAYMENT_PROVIDER потом сменили.
 */
const REGISTRY: Partial<Record<PaymentProviderKind, PaymentProvider>> = {
  MOCK: mockProvider,
  MANUAL: manualProvider,
};

/** Песочница Freedom Pay: собирается при первом обращении из env; вне APP_ENV=staging фабрика отказывает (ADR-009). */
let freedomPay: PaymentProvider | undefined;
function freedomPayFromEnv(): PaymentProvider {
  const e = env();
  const webhook = `${e.APP_URL}/api/webhooks/payments/freedompay`;
  freedomPay ??= createFreedomPayProvider({
    appEnv: e.APP_ENV,
    apiUrl: e.FREEDOMPAY_API_URL ?? "",
    merchantId: e.FREEDOMPAY_MERCHANT_ID ?? "",
    secretKey: e.FREEDOMPAY_SECRET_KEY ?? "",
    payoutSecretKey: e.FREEDOMPAY_PAYOUT_SECRET_KEY,
    resultUrl: webhook,
    payoutNotifyUrl: webhook,
    payoutBackUrl: `${e.APP_URL}/deals`,
  });
  return freedomPay;
}

const KIND: Record<PaymentProviderName, PaymentProviderKind> = { mock: "MOCK", manual: "MANUAL", freedompay: "FREEDOMPAY" };

export const providerKindOf = (name: PaymentProviderName): PaymentProviderKind => KIND[name];

/** Провайдер новых сделок — из env (APP_ENV и PAYMENT_PROVIDER, проверены в platform/env.ts). */
export const newDealProviderKind = (source: Pick<Env, "APP_ENV" | "PAYMENT_PROVIDER">): PaymentProviderKind =>
  providerKindOf(resolvePaymentProvider(source));

export function providerFor(kind: PaymentProviderKind): PaymentProvider {
  if (kind === "FREEDOMPAY") return freedomPayFromEnv();
  return REGISTRY[kind] ?? fail.unavailable(ru.payments.errors.providerNotConnected);
}

/** Тестовые деньги: операции помечаются «тестовый платёж». Неподключённый провайдер — не тестовый. */
export const isTestProvider = (kind: PaymentProviderKind): boolean => kind === "FREEDOMPAY" || (REGISTRY[kind]?.isTest ?? false);

/** Провайдеры, которые сами сообщают итог (вебхук, getStatus): их PENDING-операции опрашиваются. */
export const AUTOMATIC_KINDS: readonly PaymentProviderKind[] = ["MOCK", "FREEDOMPAY"];
