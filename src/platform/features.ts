import { env, type Env } from "./env";

/**
 * Флаги Фазы 1 (ADR-009): всё, что ТЗ относит к Фазе 2+ или что противоречит ТЗ, выключено по умолчанию,
 * но не удалено. Значения — из env (zod, platform/env.ts); оператор видит их только для чтения.
 */
export const FEATURE_KEYS = [
  "ai",
  "preContractFlows",
  "materialsCalculator",
  "reviews",
  "dealPortfolio",
  "inspiration",
  "publicShowcase",
  "executorHandSignsAct",
  "clientPhoneConsent",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type Features = Record<FeatureKey, boolean>;

/** Переменная окружения каждого флага: оператору видно, что менять. */
export const FEATURE_ENV: Record<FeatureKey, keyof Env> = {
  ai: "AI_ENABLED",
  preContractFlows: "FEATURE_PRE_CONTRACT_FLOWS",
  materialsCalculator: "FEATURE_MATERIALS_CALCULATOR",
  reviews: "FEATURE_REVIEWS",
  dealPortfolio: "FEATURE_DEAL_PORTFOLIO",
  inspiration: "FEATURE_INSPIRATION",
  publicShowcase: "FEATURE_PUBLIC_SHOWCASE",
  executorHandSignsAct: "FEATURE_EXECUTOR_HAND_SIGNS_ACT",
  clientPhoneConsent: "FEATURE_CLIENT_PHONE_CONSENT",
};

export function featuresFrom(source: Env): Features {
  return Object.fromEntries(FEATURE_KEYS.map((key) => [key, source[FEATURE_ENV[key]] === true])) as Features;
}

export function features(): Features {
  return featuresFrom(env());
}

export function isEnabled(key: FeatureKey): boolean {
  return features()[key];
}
