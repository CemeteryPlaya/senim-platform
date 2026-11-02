import type { PaymentProviderKind } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { resolvePaymentProvider, type Env } from "@/platform/env";
import { fail } from "@/platform/errors";
import type { PaymentProvider, PaymentProviderName } from "../provider";
import { manualProvider } from "./manual";
import { mockProvider } from "./mock";

/**
 * Реестр провайдеров. Провайдер сделки фиксируется при создании (Deal.paymentProvider), поэтому операции
 * сделки идут через её провайдера, даже если PAYMENT_PROVIDER потом сменили.
 */
const REGISTRY: Partial<Record<PaymentProviderKind, PaymentProvider>> = {
  MOCK: mockProvider,
  MANUAL: manualProvider,
  // INTEGRATOR: freedompay — подключить адаптер из ./freedompay (пишется параллельно): FREEDOMPAY: freedomPayProvider
};

const KIND: Record<PaymentProviderName, PaymentProviderKind> = { mock: "MOCK", manual: "MANUAL", freedompay: "FREEDOMPAY" };

export const providerKindOf = (name: PaymentProviderName): PaymentProviderKind => KIND[name];

/** Провайдер новых сделок — из env (APP_ENV и PAYMENT_PROVIDER, проверены в platform/env.ts). */
export const newDealProviderKind = (source: Pick<Env, "APP_ENV" | "PAYMENT_PROVIDER">): PaymentProviderKind =>
  providerKindOf(resolvePaymentProvider(source));

export function providerFor(kind: PaymentProviderKind): PaymentProvider {
  return REGISTRY[kind] ?? fail.unavailable(ru.payments.errors.providerNotConnected);
}

/** Тестовые деньги: операции помечаются «тестовый платёж». Неподключённый провайдер — не тестовый. */
export const isTestProvider = (kind: PaymentProviderKind): boolean => REGISTRY[kind]?.isTest ?? false;

/** Провайдеры, которые сами сообщают итог (вебхук, getStatus): их PENDING-операции опрашиваются. */
export const AUTOMATIC_KINDS: readonly PaymentProviderKind[] = ["MOCK", "FREEDOMPAY"];
