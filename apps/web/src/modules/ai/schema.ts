import { z } from "zod";
import { ru } from "@/i18n/ru";
import {
  COUNTERTOPS,
  FACADES,
  HARDWARE,
  STYLES,
  type CountertopKey,
  type FacadeKey,
  type HardwareKey,
  type StyleKey,
} from "@/verticals/furniture";

/**
 * Ответ ИИ-помощника «Опишите своими словами». Плоский объект с теми же ключами, что
 * `Request.details` в сиде (widthCm, heightCm, depthCm, facade, countertop, hardware, color, unknown),
 * плюс тип, стиль и пожелания. Все поля обязательны и nullable: так модель не «забывает» поле,
 * а явно отвечает «не знаю». Ответ провайдера — внешние данные: разбираются здесь один раз.
 */

// ─── вход от пользователя ───────────────────────────────────────────────────

export const ASSIST_TEXT_MIN = 10;
export const ASSIST_TEXT_MAX = 1000;
export const VISUALIZE_PROMPT_MAX = 300;

const id = z.string().trim().min(1).max(64);

export const assistTextSchema = z
  .string()
  .trim()
  .min(ASSIST_TEXT_MIN, ru.ai.errors.textTooShort)
  .max(ASSIST_TEXT_MAX, ru.ai.errors.textTooLong(ASSIST_TEXT_MAX));

export const assistInputSchema = z.object({ requestId: id, text: assistTextSchema });

export const visualizePromptSchema = z
  .string()
  .trim()
  .max(VISUALIZE_PROMPT_MAX, ru.ai.errors.textTooLong(VISUALIZE_PROMPT_MAX));

export const visualizeInputSchema = z.object({ requestId: id, sourceFileId: id, prompt: visualizePromptSchema.default("") });

// ─── ответ провайдера ───────────────────────────────────────────────────────

const keysOf =<K extends string>(record: Record<K, unknown>) => Object.keys(record) as [K, ...K[]];

/** «Не знаю — подскажет исполнитель»: размер или конкретный материал (как в схеме requests). */
export const DETAIL_UNKNOWN = ["size", "facade", "countertop", "hardware"] as const;
export type DetailUnknown = (typeof DETAIL_UNKNOWN)[number];

// Пределы совпадают со схемой заявки (requests/schema.ts): черновик всегда проходит её проверку.
export const SIZE_MIN_CM = 10;
export const SIZE_MAX_CM = 2000;
export const CUSTOM_TYPE_MAX = 80;
export const WISHES_MAX = 300;

const sizeCm = z.number().int().min(SIZE_MIN_CM).max(SIZE_MAX_CM).nullable();
const shortText = (max: number) => z.string().trim().min(1).max(max).nullable();

export const requestDraftSuggestionSchema = z.object({
  furnitureTypeSlug: z.string().trim().min(1).max(60).nullable(),
  customType: shortText(CUSTOM_TYPE_MAX),
  style: z.enum(keysOf(STYLES)).nullable(),
  widthCm: sizeCm,
  heightCm: sizeCm,
  depthCm: sizeCm,
  facade: z.enum(keysOf(FACADES)).nullable(),
  countertop: z.enum(keysOf(COUNTERTOPS)).nullable(),
  hardware: z.enum(keysOf(HARDWARE)).nullable(),
  color: shortText(100),
  unknown: z.array(z.enum(DETAIL_UNKNOWN)).max(DETAIL_UNKNOWN.length),
  wishes: z.string().max(WISHES_MAX),
});

export type RequestDraftSuggestion = z.infer<typeof requestDraftSuggestionSchema>;

export type ParsedSuggestion = { ok: true; suggestion: RequestDraftSuggestion } | { ok: false; issues: string[] };

export function parseDraftSuggestion(raw: unknown): ParsedSuggestion {
  const parsed = requestDraftSuggestionSchema.safeParse(raw);
  if (parsed.success) return { ok: true, suggestion: parsed.data };
  return { ok: false, issues: parsed.error.issues.map((i) => `${i.path.join(".") || "(корень)"}: ${i.message}`) };
}

/** Формат `Request.details` (как в сиде). Пустые поля отсутствуют, а не null. */
export type DraftDetails = {
  widthCm?: number;
  heightCm?: number;
  depthCm?: number;
  facade?: FacadeKey;
  countertop?: CountertopKey;
  hardware?: HardwareKey;
  color?: string;
  unknown?: DetailUnknown[];
};

/** Черновик для мастера заявки: заказчик подтверждает поля, экран переносит их в заявку. */
export type RequestDraft = {
  furnitureTypeSlug: string | null;
  customType: string | null;
  style: StyleKey | null;
  details: DraftDetails;
  wishes: string;
};

/** «Не знаю» противоречит заполненному полю — заполненное важнее. */
function isKnown(key: DetailUnknown, d: DraftDetails): boolean {
  if (key === "size") return d.widthCm !== undefined || d.heightCm !== undefined || d.depthCm !== undefined;
  return d[key] !== undefined;
}

/** null в ответе — «не сказано»: такое поле в черновик не попадает. */
function draftDetails(s: RequestDraftSuggestion): DraftDetails {
  return {
    ...(s.widthCm !== null && { widthCm: s.widthCm }),
    ...(s.heightCm !== null && { heightCm: s.heightCm }),
    ...(s.depthCm !== null && { depthCm: s.depthCm }),
    ...(s.facade !== null && { facade: s.facade }),
    ...(s.countertop !== null && { countertop: s.countertop }),
    ...(s.hardware !== null && { hardware: s.hardware }),
    ...(s.color !== null && { color: s.color }),
  };
}

/** Маппинг проверенного ответа в формат заявки; тип мебели — только из справочника оператора. */
export function toDraft(s: RequestDraftSuggestion, furnitureSlugs: readonly string[]): RequestDraft {
  const details = draftDetails(s);
  const unknown = [...new Set(s.unknown)].filter((k) => !isKnown(k, details));
  if (unknown.length > 0) details.unknown = unknown;
  const known = s.furnitureTypeSlug !== null && furnitureSlugs.includes(s.furnitureTypeSlug);
  return {
    furnitureTypeSlug: known ? s.furnitureTypeSlug : null,
    customType: s.customType,
    style: s.style,
    details,
    wishes: s.wishes,
  };
}
