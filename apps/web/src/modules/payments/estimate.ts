import { computeDealMoney } from "./money";

/**
 * Смета стороны до оплаты (ТЗ п. 5): покупатель — «Стоимость заказа · Итого к оплате» (без доплат, ADR-015),
 * мастер — «Сумма заказа · Гарантия оплаты и клиента (6%) · К выплате». Подписи — ru.payments.estimate[party].
 */
export type PartyEstimate = { party: "CLIENT" | "EXECUTOR"; priceTiyn: bigint; extraTiyn: bigint; totalTiyn: bigint };

export function partyEstimate(party: PartyEstimate["party"], priceTiyn: bigint): PartyEstimate {
  const m = computeDealMoney(priceTiyn);
  return party === "CLIENT"
    ? { party, priceTiyn, extraTiyn: m.protectionTiyn, totalTiyn: m.buyerTotalTiyn }
    : { party, priceTiyn, extraTiyn: m.guaranteeTiyn, totalTiyn: m.payoutTiyn };
}
