/**
 * Ключи идемпотентности операций журнала (ADR-009 раздел 4) — одно место. Тот же ключ — та же операция:
 * повторная запись, повторный вызов провайдера и повторный вебхук не создают второй.
 * Повтор отклонённой банком оплаты — новая попытка со своим ключом (`hold:<dealId>:2`).
 */
export const moneyKey = {
  hold: (dealId: string, attempt = 1) => (attempt === 1 ? `hold:${dealId}` : `hold:${dealId}:${attempt}`),
  release: (dealId: string) => `release:${dealId}`,
  splitMaster: (dealId: string) => `split-master:${dealId}`,
  splitPlatform: (dealId: string) => `split-platform:${dealId}`,
  refund: (dealId: string) => `refund:${dealId}`,
  freeze: (disputeId: string) => `freeze:${disputeId}`,
  unfreeze: (disputeId: string) => `unfreeze:${disputeId}`,
};
