import type { MoneyTransactionType } from "@/generated/prisma/enums";

/**
 * Ключи идемпотентности операций журнала (ADR-009 раздел 4) — одно место. Тот же ключ — та же операция:
 * повторная запись, повторный вызов провайдера и повторный вебхук не создают второй.
 * Повтор отклонённой банком операции — новая попытка со своим ключом: `hold:<dealId>:2`, `refund:<dealId>:3`.
 * Первая попытка — без номера (ключи, записанные до повторов, остаются прежними).
 */
const attempt = (key: string, n: number) => (n === 1 ? key : `${key}:${n}`);

export const moneyKey = {
  hold: (dealId: string, n = 1) => attempt(`hold:${dealId}`, n),
  release: (dealId: string, n = 1) => attempt(`release:${dealId}`, n),
  splitMaster: (dealId: string, n = 1) => attempt(`split-master:${dealId}`, n),
  splitPlatform: (dealId: string, n = 1) => attempt(`split-platform:${dealId}`, n),
  refund: (dealId: string, n = 1) => attempt(`refund:${dealId}`, n),
  freeze: (disputeId: string) => `freeze:${disputeId}`,
  unfreeze: (disputeId: string) => `unfreeze:${disputeId}`,
};

/** Операции, которые повторяет оператор после отказа банка (оплату повторяет сам покупатель). */
export const RETRIABLE_TYPES = ["RELEASE", "SPLIT_MASTER", "SPLIT_PLATFORM", "REFUND"] as const satisfies readonly MoneyTransactionType[];
export type RetriableType = (typeof RETRIABLE_TYPES)[number];

export const isRetriableType = (type: MoneyTransactionType): type is RetriableType => (RETRIABLE_TYPES as readonly MoneyTransactionType[]).includes(type);

/** Ключ попытки n операции типа по сделке. */
export const attemptKey: Record<RetriableType, (dealId: string, n: number) => string> = {
  RELEASE: moneyKey.release,
  SPLIT_MASTER: moneyKey.splitMaster,
  SPLIT_PLATFORM: moneyKey.splitPlatform,
  REFUND: moneyKey.refund,
};
