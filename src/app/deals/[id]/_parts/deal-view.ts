import type { GeolocationState } from "@/app/_components/geolocation";
import type { DealStatus } from "@/generated/prisma/enums";
import type { PartyEstimate } from "@/modules/payments";
import { ru } from "@/i18n/ru";
import { formatDate, formatDateTime, formatDays, formatMonths, formatTiyn } from "@/ui/format";

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

type ReadyGps = { distanceM: number | null; withinRadius: boolean | null; radiusM: number };

/**
 * Мастер только что сдал работу дальше радиуса: «Что дальше» говорит об этом сразу (live), а не только
 * плашкой в разделе «Сдача» ниже. Сдача не блокируется — расстояние попадает в акт.
 */
export function readyFarWarning(d: { viewer: "CLIENT" | "EXECUTOR" | "OPERATOR"; status: DealStatus; ready: ReadyGps | null }): string | null {
  const r = d.ready;
  if (d.viewer !== "EXECUTOR" || d.status !== "READY" || !r || r.withinRadius !== false || r.distanceM === null) return null;
  return ru.deal.ready.gpsWarning(r.distanceM, r.radiusM);
}

/** Строка под «Сдать работу» (aria-live): ждём фото, определяем место или почему места не будет (сдача идёт и так). */
export function readyWaitText(s: { uploading: boolean; geo: GeolocationState }): string {
  if (s.uploading) return ru.deal.ready.waitPhotos;
  if (s.geo.status === "locating") return ru.deal.ready.locating;
  return s.geo.status === "failed" ? s.geo.error.message : "";
}

export type Fact = { label: string; value: string };

type OrderInput = {
  viewer: "CLIENT" | "EXECUTOR" | "OPERATOR";
  executorLabel: string;
  city: string | null;
  plannedReadyAt: Date | null;
  signedAt: Date | null;
  durationDays: number;
  warrantyMonths: number;
};

/** Строки «Подробнее о заказе»: другая сторона, город, плановая готовность, срок, гарантия, дата оферты. */
export function orderFacts(o: OrderInput): Fact[] {
  const v = ru.deal.view;
  const party = o.viewer === "EXECUTOR" ? { label: v.client, value: ru.deal.clientLabel } : { label: v.executor, value: o.executorLabel };
  return [
    party,
    ...(o.city ? [{ label: v.city, value: o.city }] : []),
    ...(o.plannedReadyAt ? [{ label: v.plannedReady, value: formatDate(o.plannedReadyAt) }] : []),
    { label: v.duration, value: formatDays(o.durationDays) },
    { label: v.warranty, value: formatMonths(o.warrantyMonths) },
    ...(o.signedAt ? [{ label: v.signedAt, value: formatDate(o.signedAt) }] : []),
  ];
}

type DisputeInput = {
  reason: keyof typeof ru.deal.dispute.reason;
  createdAt: Date;
  description: string;
  clientPosition: string | null;
  executorPosition: string | null;
  outcome: keyof typeof ru.deal.dispute.outcome | null;
  masterShareTiyn: bigint | null;
  rationale: string | null;
};

/** Факты спора: причина, когда открыт, описание, позиции сторон; после решения — итог, доля мастера, обоснование. */
export function disputeFacts(d: DisputeInput): Fact[] {
  const s = ru.deal.dispute;
  return [
    { label: s.reasonLabel, value: s.reason[d.reason] },
    { label: s.openedAt, value: formatDateTime(d.createdAt) },
    { label: s.descriptionLabel, value: d.description },
    { label: s.clientPosition, value: d.clientPosition ?? s.noPosition },
    { label: s.executorPosition, value: d.executorPosition ?? s.noPosition },
    ...(d.outcome ? [{ label: s.resolved, value: s.outcome[d.outcome] }] : []),
    ...(d.masterShareTiyn !== null ? [{ label: s.masterShare, value: formatTiyn(d.masterShareTiyn) }] : []),
    ...(d.rationale ? [{ label: s.rationale, value: d.rationale }] : []),
  ];
}

/** Нужна ли смотрящему форма своей позиции: он сторона, спор открыт, своей позиции ещё нет. */
export function needsPosition(viewer: "CLIENT" | "EXECUTOR" | "OPERATOR", d: { status: "OPEN" | "RESOLVED"; clientPosition: string | null; executorPosition: string | null }): boolean {
  if (d.status !== "OPEN" || viewer === "OPERATOR") return false;
  return (viewer === "CLIENT" ? d.clientPosition : d.executorPosition) === null;
}
