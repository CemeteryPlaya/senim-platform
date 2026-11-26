import { ru } from "@/i18n/ru";
import { computeDealMoney, kztToTiyn } from "@/modules/payments/client";
import type { MoneyView } from "./request-view";
import { parsePriceKzt } from "./schema";

const t = ru.app.masterOffer.money;

/** Деньги мастера по введённой цене: цена по оферте X, гарантия 6% (вниз до тиына), «Вы получите». Тиыны. */
export type LiveMoney = { priceTiyn: bigint; guaranteeTiyn: bigint; youGetTiyn: bigint };

/**
 * Живой расчёт «Вы получите» в форме предложения (ТЗ п. 6): та же формула, что у сделки и у `partyEstimate("EXECUTOR")`
 * модуля, — `computeDealMoney` из клиентской части payments; на экране ничего не считается вручную. Цена разбирается той
 * же схемой, что на сервере (`parsePriceKzt`); не цена или вне границ — `null` (расчёта нет).
 */
export function liveMoney(raw: string): LiveMoney | null {
  const kzt = parsePriceKzt(raw);
  if (kzt === null) return null;
  const m = computeDealMoney(kztToTiyn(kzt));
  return { priceTiyn: m.priceTiyn, guaranteeTiyn: m.guaranteeTiyn, youGetTiyn: m.payoutTiyn };
}

/**
 * Смета формы для `MasterMoney`: «Вы получите» крупно (заголовок блока), под ним «Цена покупателю X» и «Гарантия оплаты и
 * клиента (6%)»; строкой итога сумма не повторяется. Нет цены — `null`.
 */
export function formMoney(raw: string): MoneyView | null {
  const m = liveMoney(raw);
  if (!m) return null;
  return {
    title: t.title,
    amountTiyn: m.youGetTiyn,
    rows: [
      { label: t.price.form, amountTiyn: m.priceTiyn },
      { label: t.guarantee, amountTiyn: m.guaranteeTiyn, explain: true },
    ],
  };
}
