import { z } from "zod";
import { ru } from "@/i18n/ru";
import { COUNTERTOPS, FACADES, HARDWARE, STAGE_TEMPLATES, STYLES, type SegmentInput } from "@/verticals/furniture";

/**
 * Данные заявки на входе и в БД (`Request.details`). Разбираются один раз — здесь;
 * внутри модуля значения уже проверены. Модуль без server-only: схемы нужны и форме мастера.
 */

const t = ru.requests.validation;

function keysOf<T extends Record<string, unknown>>(o: T): [keyof T & string, ...(keyof T & string)[]] {
  return Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
}

export const FACADE_KEYS = keysOf(FACADES);
export const COUNTERTOP_KEYS = keysOf(COUNTERTOPS);
export const HARDWARE_KEYS = keysOf(HARDWARE);
export const STYLE_KEYS = keysOf(STYLES);

/** Материалы, у каждого из которых есть вариант «Не знаю — подскажет исполнитель». */
export const MATERIAL_FIELDS = ["facade", "countertop", "hardware"] as const;
export type MaterialField = (typeof MATERIAL_FIELDS)[number];

/** Что заказчик отметил «не знаю». В сиде встречается групповое «materials» — оно раскрывается в три поля. */
export const UNKNOWN_KEYS = ["size", ...MATERIAL_FIELDS] as const;
export type UnknownKey = (typeof UNKNOWN_KEYS)[number];

/** Дополнительно (флажки на шаге «Детали 2»). */
export const EXTRAS = ["lighting", "sockets", "sink", "appliances"] as const;
export type Extra = (typeof EXTRAS)[number];

export const SEGMENTS = ["ECONOMY", "COMFORT", "PREMIUM"] as const;

export const LIMITS = {
  cmMin: 10,
  cmMax: 2000,
  color: 100,
  description: 500,
  styleNote: 300,
  customType: 80,
  wishes: 300,
  address: 200,
  city: 60,
  photos: 10,
} as const;

const cm = z.number({ error: t.size }).int(t.size).min(LIMITS.cmMin, t.size).max(LIMITS.cmMax, t.size);

const unknownList = z.preprocess(
  (v) => (Array.isArray(v) ? [...new Set(v.flatMap((k) => (k === "materials" ? MATERIAL_FIELDS : [k])))] : v),
  z.array(z.enum(UNKNOWN_KEYS)),
);

export const requestDetailsSchema = z
  .strictObject({
    widthCm: cm.optional(),
    heightCm: cm.optional(),
    depthCm: cm.optional(),
    facade: z.enum(FACADE_KEYS).optional(),
    countertop: z.enum(COUNTERTOP_KEYS).optional(),
    hardware: z.enum(HARDWARE_KEYS).optional(),
    color: z.string().trim().max(LIMITS.color, t.tooLong(LIMITS.color)).optional(),
    extras: z.array(z.enum(EXTRAS)).optional(),
    description: z.string().trim().max(LIMITS.description, t.tooLong(LIMITS.description)).optional(),
    styleNote: z.string().trim().max(LIMITS.styleNote, t.tooLong(LIMITS.styleNote)).optional(),
    unknown: unknownList.optional(),
  })
  .superRefine((d, ctx) => {
    const unknown = new Set(d.unknown ?? []);
    if (unknown.has("size") && (d.widthCm || d.heightCm || d.depthCm)) {
      ctx.addIssue({ code: "custom", path: ["unknown"], message: t.knownAndUnknown });
    }
    for (const field of MATERIAL_FIELDS) {
      if (unknown.has(field) && d[field]) ctx.addIssue({ code: "custom", path: [field], message: t.knownAndUnknown });
    }
  });

export type RequestDetails = z.output<typeof requestDetailsSchema>;

/** Разбор `Request.details` из БД. Пишет туда только этот модуль, поэтому ошибка — это поломка, а не ввод. */
export function parseDetails(json: unknown): RequestDetails {
  return requestDetailsSchema.parse(json);
}

/** Вход правил сегмента: поля «не знаю» не участвуют. */
export function segmentInputOf(d: RequestDetails): SegmentInput {
  return { widthCm: d.widthCm, facade: d.facade, countertop: d.countertop, hardware: d.hardware };
}

// ─── шаги мастера ────────────────────────────────────────────────────────────

/** Экраны мастера по порядку. «Детали» — два экрана: размеры и материалы. */
export const WIZARD_SCREENS = ["type", "style", "room", "size", "materials", "send"] as const;
export type WizardScreen = (typeof WIZARD_SCREENS)[number];

const optionalText = (max: number) => z.string().trim().max(max, t.tooLong(max)).default("");

const typeStep = z
  .strictObject({
    screen: z.literal("type"),
    furnitureTypeId: z.string().min(1).nullable(),
    customType: z.string().trim().max(LIMITS.customType, t.tooLong(LIMITS.customType)).nullable(),
  })
  .refine((s) => (s.furnitureTypeId === null) !== (s.customType === null || s.customType === ""), {
    message: t.typeRequired,
    path: ["furnitureTypeId"],
  });

const styleStep = z.strictObject({
  screen: z.literal("style"),
  style: z.enum(STYLE_KEYS).nullable(),
  styleNote: optionalText(LIMITS.styleNote),
});

const roomStep = z.strictObject({
  screen: z.literal("room"),
  photoFileIds: z.array(z.string().min(1)).max(LIMITS.photos),
});

const sizeStep = z.strictObject({
  screen: z.literal("size"),
  size: z.discriminatedUnion("mode", [
    z.strictObject({ mode: z.literal("known"), widthCm: cm, heightCm: cm.nullable(), depthCm: cm.nullable() }),
    z.strictObject({ mode: z.literal("unknown") }),
  ]),
});

const choice = <T extends readonly [string, ...string[]]>(keys: T) => z.enum([...keys, "unknown"], { error: t.chooseOrUnknown });

const materialsStep = z.strictObject({
  screen: z.literal("materials"),
  facade: choice(FACADE_KEYS),
  countertop: z.enum([...COUNTERTOP_KEYS, "unknown", "none"], { error: t.chooseOrUnknown }),
  hardware: choice(HARDWARE_KEYS),
  color: optionalText(LIMITS.color),
  extras: z.array(z.enum(EXTRAS)).default([]),
  description: optionalText(LIMITS.description),
});

const sendStep = z.strictObject({
  screen: z.literal("send"),
  segment: z.enum(SEGMENTS, { error: t.segmentRequired }),
  city: z.string().trim().min(2, t.cityRequired).max(LIMITS.city),
  address: z.string().trim().min(5, t.addressRequired).max(LIMITS.address, t.tooLong(LIMITS.address)),
  desiredDate: z.iso.date(t.date).nullable(),
  wishes: optionalText(LIMITS.wishes),
});

export const stepInputSchema = z.discriminatedUnion("screen", [typeStep, styleStep, roomStep, sizeStep, materialsStep, sendStep]);
export type StepInput = z.output<typeof stepInputSchema>;
export type StepFormInput = z.input<typeof stepInputSchema>;

// ─── входы сервиса (Server Actions разбирают их этими схемами) ────────────────

const id = z.string().min(1).max(64);

export const saveDraftSchema = z.strictObject({
  requestId: id.nullable(),
  /** «Хочу похожее»: работа из портфолио — только при создании черновика. */
  like: id.nullable().optional(),
  step: stepInputSchema,
});
export type SaveDraftInput = z.output<typeof saveDraftSchema>;

export const requestRefSchema = z.strictObject({ requestId: id });
export const cancelRequestSchema = z.strictObject({ requestId: id, reason: optionalText(300) });
export const offerRefSchema = z.strictObject({ offerId: id });

export const OFFER_SORTS = ["price", "duration", "rating"] as const;
export type OfferSort = (typeof OFFER_SORTS)[number];
export const listOffersSchema = z.strictObject({ requestId: id, sort: z.enum(OFFER_SORTS).default("price") });
export const offerDetailSchema = z.strictObject({ requestId: id, offerId: id });

const money = z.number({ error: t.price }).int(t.price).min(1, t.price).max(100_000_000, t.price);
const MEASUREMENT_TERMS = ["FREE", "INCLUDED", "FEE_IF_NO_DEAL"] as const;

export const sendOfferSchema = z
  .strictObject({
    requestId: id,
    price: money,
    durationDays: z.number({ error: t.days }).int(t.days).min(1, t.days).max(365, t.days),
    warrantyMonths: z.number({ error: t.warranty }).int(t.warranty).min(0, t.warranty).max(120, t.warranty),
    comment: optionalText(1000),
    /** Не указаны — берутся из профиля исполнителя. */
    measurementTerms: z.enum(MEASUREMENT_TERMS).optional(),
    measurementFee: money.nullable().optional(),
  })
  .refine((o) => o.measurementTerms !== "FEE_IF_NO_DEAL" || (o.measurementFee ?? 0) > 0, {
    message: t.feeRequired,
    path: ["measurementFee"],
  });
export type SendOfferInput = z.output<typeof sendOfferSchema>;

export const scheduleMeasurementSchema = z.strictObject({ offerId: id, scheduledAt: z.coerce.date({ error: t.date }) });
export const completeMeasurementSchema = z.strictObject({ measurementId: id, finalPrice: money, result: optionalText(1000) });
export const noDealSchema = z.strictObject({ measurementId: id, result: optionalText(1000) });

/** Шаблон этапов из вертикали: заказчик выбирает порядок оплаты при согласии на договор. */
/** ФИО и ИИН заказчика — только если их ещё нет (проверяет identity.recordClientIdentity). */
const clientIdentity = z.strictObject({ fullName: z.string().trim().max(120), iin: z.string().trim().regex(/^\d{12}$/) });
export const agreeToContractSchema = z.strictObject({
  requestId: id,
  template: z.enum(keysOf(STAGE_TEMPLATES)),
  identity: clientIdentity.optional(),
});

/** Номер экрана (с нуля). `Request.wizardStep` — сколько экранов уже сохранено. */
export function screenIndex(screen: WizardScreen): number {
  return WIZARD_SCREENS.indexOf(screen);
}

function withUnknown(d: RequestDetails, key: UnknownKey, isUnknown: boolean): UnknownKey[] | undefined {
  const rest = (d.unknown ?? []).filter((k) => k !== key);
  const next = isUnknown ? [...rest, key] : rest;
  return next.length > 0 ? next : undefined;
}

/** Убирает пустые значения, чтобы в JSON не было `undefined` и пустых строк. */
function compact(d: RequestDetails): RequestDetails {
  return Object.fromEntries(
    Object.entries(d).filter(([, v]) => v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0)),
  ) as RequestDetails;
}

/** Новые `details` после шага мастера. Шаги без технических полей details не меняют. */
export function applyStep(d: RequestDetails, step: StepInput): RequestDetails {
  switch (step.screen) {
    case "style":
      return compact({ ...d, styleNote: step.styleNote });
    case "size": {
      const known = step.size.mode === "known" ? step.size : null;
      return compact({
        ...d,
        widthCm: known?.widthCm,
        heightCm: known?.heightCm ?? undefined,
        depthCm: known?.depthCm ?? undefined,
        unknown: withUnknown(d, "size", known === null),
      });
    }
    case "materials": {
      let next: RequestDetails = { ...d, color: step.color, extras: step.extras, description: step.description };
      next = { ...next, facade: step.facade === "unknown" ? undefined : step.facade, unknown: withUnknown(next, "facade", step.facade === "unknown") };
      next = {
        ...next,
        countertop: step.countertop === "unknown" || step.countertop === "none" ? undefined : step.countertop,
        unknown: withUnknown(next, "countertop", step.countertop === "unknown"),
      };
      next = { ...next, hardware: step.hardware === "unknown" ? undefined : step.hardware, unknown: withUnknown(next, "hardware", step.hardware === "unknown") };
      return compact(next);
    }
    case "type":
    case "room":
    case "send":
      return d;
  }
}
