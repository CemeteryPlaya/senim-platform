import type { CurrentUser } from "@/modules/identity";
import { env, resolvePaymentProvider, type PaymentProviderName } from "@/platform/env";
import { FEATURE_ENV, FEATURE_KEYS, features, type FeatureKey } from "@/platform/features";
import { assertOperator } from "./access";

/**
 * Настройки платформы для оператора — только чтение (ADR-009 раздел 8): флаги и окружение задаются env,
 * экран показывает, какое значение действует и какую переменную менять.
 */
export type PlatformSettings = {
  appEnv: "dev" | "staging" | "prod";
  demoMode: boolean;
  /** Провайдер, который получат новые сделки (идущие сделки остаются со своим). */
  newDealProvider: PaymentProviderName;
  /** PAYMENT_PROVIDER не задан — провайдер выбран по APP_ENV. */
  providerFromDefault: boolean;
  flags: { key: FeatureKey; envVar: string; enabled: boolean }[];
};

export function platformSettings(operator: CurrentUser): PlatformSettings {
  assertOperator(operator);
  const e = env();
  const current = features();
  return {
    appEnv: e.APP_ENV,
    demoMode: e.DEMO_MODE,
    newDealProvider: resolvePaymentProvider(e),
    providerFromDefault: e.PAYMENT_PROVIDER === undefined,
    flags: FEATURE_KEYS.map((key) => ({ key, envVar: FEATURE_ENV[key], enabled: current[key] })),
  };
}
