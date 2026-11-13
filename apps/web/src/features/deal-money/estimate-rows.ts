import type { PartyEstimate } from "@/modules/payments";
import { ru } from "@/i18n/ru";
import { formatTiyn } from "@/features/format/format";

export type EstimateRow = { label: string; value: string; total: boolean };

/** Покупатель: стоимость + защита = итого; мастер: сумма − гарантия = к выплате (знак показывает, куда идёт сумма). */
export function estimateRows(e: PartyEstimate): EstimateRow[] {
  const t = ru.payments.estimate[e.party];
  const extra = e.party === "EXECUTOR" ? -e.extraTiyn : e.extraTiyn;
  return [
    { label: t.price, value: formatTiyn(e.priceTiyn), total: false },
    { label: t.extra, value: formatTiyn(extra), total: false },
    { label: t.total, value: formatTiyn(e.totalTiyn), total: true },
  ];
}
