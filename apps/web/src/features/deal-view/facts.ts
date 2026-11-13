import { ru } from "@/i18n/ru";
import { formatDate, formatDateTime, formatDays, formatMonths, formatTiyn } from "@/features/format/format";

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
