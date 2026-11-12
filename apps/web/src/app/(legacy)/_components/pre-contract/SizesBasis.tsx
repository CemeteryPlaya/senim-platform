import type { ReactNode } from "react";
import { ru } from "@/i18n/ru";
import type { PreContractView } from "@/modules/requests";
import { StatusBadge, formatDate } from "@/ui";

const p = ru.requests.pre;

type Pre = Pick<PreContractView, "rules" | "site">;

/**
 * Пометка у откликов: по чьим размерам считали цену. Сценарий 2 — по точным размерам площадки,
 * сценарий 5 — по размерам заказчика. В остальных сценариях пометки нет: цена предварительная до замера.
 */
export function SizesBasis({ pre }: { pre: Pre }) {
  if (pre.rules.siteMeasure && pre.site?.status === "DONE") return <StatusBadge tone="success">{p.site.measuredBadge}</StatusBadge>;
  if (pre.rules.selfMeasure) return <StatusBadge tone="info">{p.selfMeasure.badge}</StatusBadge>;
  return null;
}

/** Строки «что в заявке» о замере площадки: размеры, заметки, дата. Кто замерял — не показывается. */
export function siteRows(pre: Pre): { label: string; value: ReactNode }[] {
  const s = pre.site;
  if (!s || s.status !== "DONE") return [];
  return [
    { label: p.site.factsTitle, value: <StatusBadge tone="success">{p.site.measuredBadge}</StatusBadge> },
    { label: p.site.sizes, value: ru.requests.facts.sizeValue(s.widthCm ?? undefined, s.heightCm ?? undefined, s.depthCm ?? undefined) },
    ...(s.notes ? [{ label: p.site.notes, value: s.notes }] : []),
    ...(s.doneAt ? [{ label: p.site.measuredAt, value: formatDate(s.doneAt) }] : []),
  ];
}
