import type { DealStatus } from "@/generated/prisma/enums";
import type { PartyEstimate } from "@/modules/payments";
import { ru } from "@/i18n/ru";
import { formatTiyn } from "@/ui/format";

/**
 * Чистые правила экрана сделки: шаг шкалы «Ход сделки», смета до оплаты, главное фото, строка геолокации сдачи.
 * Без React — проверяются юнит-тестом.
 */

/** Шаги ru.deal.view.steps: оферта, оплата, работа, сдача, приёмка, выплата. Конечные отмена и возврат — без шкалы. */
const STEP: Partial<Record<DealStatus, number>> = { PAID_HOLD: 2, IN_PROGRESS: 3, READY: 4, ACCEPTED: 5, SPLIT_PAYOUT: 5 };

export function dealStep(status: DealStatus, signed: boolean): number | null {
  if (status === "CREATED") return signed ? 1 : 0;
  return STEP[status] ?? null;
}

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

type Src = { src: string };

/** Главное фото: сдача, иначе последний отчёт «Хода работ» с фото, иначе фото помещения, иначе иллюстрация типа. */
export function heroImage(p: { ready: readonly Src[]; progress: readonly (readonly Src[])[]; room: readonly Src[]; illustration: string | null }): string | null {
  const report = p.progress.findLast((photos) => photos.length > 0);
  return p.ready[0]?.src ?? report?.[0]?.src ?? p.room[0]?.src ?? p.illustration;
}

export type GpsNote = { tone: "ok" | "warning" | "unknown"; text: string };

/** Мягкая проверка GPS: дальше радиуса — предупреждение (не запрет), без координат — так и пишем. */
export function gpsNote(r: { distanceM: number | null; withinRadius: boolean | null; radiusM: number }): GpsNote {
  const t = ru.deal.ready;
  if (r.distanceM === null) return { tone: "unknown", text: t.gpsUnknown };
  return r.withinRadius ? { tone: "ok", text: t.gpsOk(r.distanceM) } : { tone: "warning", text: t.gpsFar(r.distanceM, r.radiusM) };
}
