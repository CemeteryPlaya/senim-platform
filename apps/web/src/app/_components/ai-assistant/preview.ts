import { ru } from "@/i18n/ru";
import type { DraftDetails, RequestDraft } from "@/modules/ai/client";
import { COUNTERTOPS, FACADES, HARDWARE, STYLES } from "@/verticals/furniture/catalog";

/** Поля черновика, которые заказчик видит и может снять перед переносом в заявку. */
export type PreviewKey =
  | "furnitureType"
  | "customType"
  | "style"
  | "size"
  | "facade"
  | "countertop"
  | "hardware"
  | "color"
  | "unknown"
  | "wishes";

export type PreviewRow = { key: PreviewKey; label: string; value: string };

const t = ru.ai.assistant;

export function previewRows(draft: RequestDraft, furnitureNames: Readonly<Record<string, string>>): PreviewRow[] {
  const d = draft.details;
  const values: [PreviewKey, string | null | undefined][] = [
    ["furnitureType", draft.furnitureTypeSlug && (furnitureNames[draft.furnitureTypeSlug] ?? draft.furnitureTypeSlug)],
    ["customType", draft.customType],
    ["style", draft.style && STYLES[draft.style].name],
    ["size", t.sizeValue(d.widthCm, d.heightCm, d.depthCm)],
    ["facade", d.facade && FACADES[d.facade].name],
    ["countertop", d.countertop && COUNTERTOPS[d.countertop].name],
    ["hardware", d.hardware && HARDWARE[d.hardware].name],
    ["color", d.color],
    ["unknown", d.unknown?.map((k) => t.unknownValue[k]).join(", ")],
    ["wishes", draft.wishes],
  ];
  return values
    .filter((entry): entry is [PreviewKey, string] => Boolean(entry[1]))
    .map(([key, value]) => ({ key, label: t.fields[key], value }));
}

/** Черновик только с отмеченными полями: снятое не переносится в заявку. */
export function pickFields(draft: RequestDraft, keys: ReadonlySet<PreviewKey>): RequestDraft {
  const has = (k: PreviewKey) => keys.has(k);
  return {
    furnitureTypeSlug: has("furnitureType") ? draft.furnitureTypeSlug : null,
    customType: has("customType") ? draft.customType : null,
    style: has("style") ? draft.style : null,
    details: pickDetails(draft.details, has),
    wishes: has("wishes") ? draft.wishes : "",
  };
}

/** Размеры — одной галочкой «size» (0 — тоже размер); остальные поля — своей галочкой, пустые не переносятся. */
function pickDetails(d: DraftDetails, has: (k: PreviewKey) => boolean): DraftDetails {
  const details: DraftDetails = {};
  const copy = <K extends keyof DraftDetails>(key: K, keep: boolean) => {
    if (keep) details[key] = d[key];
  };
  for (const key of ["widthCm", "heightCm", "depthCm"] as const) copy(key, has("size") && d[key] !== undefined);
  for (const key of ["facade", "countertop", "hardware", "color", "unknown"] as const) copy(key, has(key) && Boolean(d[key]));
  return details;
}
