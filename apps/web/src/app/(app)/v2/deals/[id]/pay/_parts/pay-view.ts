import { ru } from "@/i18n/ru";
import type { MoneyBlock, PartyEstimate } from "@/modules/payments";

const t = ru.app.deal.pay.money;
const p = ru.app.deal.pay;

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

/**
 * Отметка действует только для редакции, при которой её поставили: сменилась редакция текста (сервер ответил «текст
 * обновился», экран перечитан) — отметка снята и её ставят заново, как в v1.
 */
export const isAgreed = (agreedVersion: string | null, version: string): boolean => agreedVersion === version;

/** Подпись главной кнопки: перевод по реквизитам — «Оплатить переводом N ₸», онлайн — «Оплатить N ₸». */
export const payLabel = (amount: string, manual: boolean): string => (manual ? p.manual.submit(amount) : p.submit(amount));

/** Тост на карточке после оплаты: перевод — что сделать дальше (без суммы: она в «Сейчас»); онлайн — итог операции. */
export function paidToast(data: { status: "PENDING" | "SUCCEEDED" | "FAILED" }, manual: boolean): string {
  if (manual) return p.manual.done;
  return data.status === "SUCCEEDED" ? p.done.SUCCEEDED : p.done.PENDING;
}

/**
 * Сумма для копирования в банковское приложение: цифры без пробелов и знака валюты, тиыны через точку, только если они есть
 * («1224000», «101.05»). Тиыны — целые (`bigint`), без дробных чисел.
 */
export function transferAmount(tiyn: bigint): string {
  const cents = tiyn % 100n;
  return `${tiyn / 100n}${cents === 0n ? "" : `.${cents.toString().padStart(2, "0")}`}`;
}
