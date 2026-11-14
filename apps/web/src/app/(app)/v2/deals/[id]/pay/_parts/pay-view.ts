import { ru } from "@/i18n/ru";
import type { MoneyBlock, PartyEstimate } from "@/modules/payments";

const t = ru.app.deal.pay.money;

export type PayMoney = {
  /** «К оплате» — главная сумма блока и сумма на кнопке. */
  amount: bigint;
  rows: { label: string; amount: bigint; total?: boolean; explain?: true }[];
  /** Прошлая попытка оплаты не прошла (журнал денег): деньги не списаны, можно ещё раз. */
  failed: boolean;
};

/**
 * Деньги экрана оплаты — смета покупателя модуля (`deal.estimate` = `partyEstimate("CLIENT", цена)`, тот же источник, что
 * у блока денег карточки сделки до оплаты): цена по оферте, защита сделки (2%) с пояснением, итого. На экране ничего не
 * считается. Пометка тестового платежа (`isTest`) в v2 не выводится.
 */
export function payMoney(estimate: Pick<PartyEstimate, "priceTiyn" | "extraTiyn" | "totalTiyn">, block: MoneyBlock): PayMoney {
  return {
    amount: estimate.totalTiyn,
    rows: [
      { label: t.price, amount: estimate.priceTiyn },
      { label: t.protection, amount: estimate.extraTiyn, explain: true },
      { label: t.total, amount: estimate.totalTiyn, total: true },
    ],
    failed: block.kind === "awaiting" && block.payment === "FAILED",
  };
}
