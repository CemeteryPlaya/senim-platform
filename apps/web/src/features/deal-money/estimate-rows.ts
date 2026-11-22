import type { PartyEstimate } from "@/modules/payments";
import { ru } from "@/i18n/ru";
import { formatTiyn } from "@/features/format/format";

export type EstimateRow = { label: string; value: string; total: boolean };

/** Покупатель: стоимость = итого, без доплат (ADR-015); мастер: сумма − гарантия = к выплате (знак показывает, куда идёт сумма). */
export function estimateRows(e: PartyEstimate): EstimateRow[] {
  if (e.party === "CLIENT") {
    const t = ru.payments.estimate.CLIENT;
    return [
      { label: t.price, value: formatTiyn(e.priceTiyn), total: false },
      { label: t.total, value: formatTiyn(e.totalTiyn), total: true },
    ];
  }
  const t = ru.payments.estimate.EXECUTOR;
  return [
    { label: t.price, value: formatTiyn(e.priceTiyn), total: false },
    { label: t.extra, value: formatTiyn(-e.extraTiyn), total: false },
    { label: t.total, value: formatTiyn(e.totalTiyn), total: true },
  ];
}
