import type { MoneyBlock } from "@/modules/payments";
import { ru } from "@/i18n/ru";
import { moneyPanel } from "./money-panel";

export type HomeDealMoney = { amountTiyn: bigint | null; label: string };

/**
 * Строка денег карточки «Моя сделка» на главной покупателя — только из журнала (moneyBlock), как блок денег сделки:
 * оплачено — в банке вся оплата (HOLD); спор — остаток на счёте сделки (не замороженная выплата мастеру);
 * выплата или возврат — заголовок блока денег без отдельной суммы; до оплаты — смета «к оплате».
 */
export function homeDealMoney(m: MoneyBlock, estimate: { totalTiyn: bigint }): HomeDealMoney {
  const c = ru.common.home.client;
  switch (m.kind) {
    case "protected":
      return { amountTiyn: m.amountTiyn, label: c.inBank };
    case "frozen":
      return { amountTiyn: m.bankBalanceTiyn, label: c.inBank };
    case "completed":
    case "refunded":
      return { amountTiyn: null, label: moneyPanel(m, "CLIENT", 0n).title };
    case "awaiting":
      return { amountTiyn: estimate.totalTiyn, label: c.toPay };
  }
}
