import { z } from "zod";
import { ru } from "@/i18n/ru";
import { COUNTERTOPS, FACADES, HARDWARE, STYLES, type SegmentInput } from "@/verticals/furniture";

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

/**
 * Экраны мастера по порядку (ТЗ п. 3, решение 2.2.11): на первом — только тип и стиль; всё техническое
 * (размеры, ЛДСП/МДФ, фурнитура) — в свёрнутом блоке «Для продвинутых» первого экрана, у каждого поля «не знаю».
 * Дальше — уровень → фото (можно пропустить) → адрес и точка → проверка.
 * Шаги `type`, `style`, `size`, `materials` — не экраны: их сохраняет помощник ИИ при переносе черновика.
 */
export const WIZARD_SCREENS = ["start", "segment", "room", "place", "send"] as const;
export type WizardScreen = (typeof WIZARD_SCREENS)[number];

const optionalText = (max: number) => z.string().trim().max(max, t.tooLong(max)).default("");

const typeFields = {
  furnitureTypeId: z.string().min(1).nullable(),
  customType: z.string().trim().max(LIMITS.customType, t.tooLong(LIMITS.customType)).nullable(),
};
/** Тип — либо из справочника, либо свой текст. */
const oneType = (s: { furnitureTypeId: string | null; customType: string | null }) => (s.furnitureTypeId === null) !== (s.customType === null || s.customType === "");
const typeRefine = { message: t.typeRequired, path: ["furnitureTypeId"] };

const typeStep = z.strictObject({ screen: z.literal("type"), ...typeFields }).refine(oneType, typeRefine);

const styleStep = z.strictObject({
  screen: z.literal("style"),
  style: z.enum(STYLE_KEYS).nullable(),
  styleNote: optionalText(LIMITS.styleNote),
});

const roomStep = z.strictObject({
  screen: z.literal("room"),
  photoFileIds: z.array(z.string().min(1)).max(LIMITS.photos),
  /** Описание своими словами. */
  description: optionalText(LIMITS.description),
});

const sizeInput = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("known"), widthCm: cm, heightCm: cm.nullable(), depthCm: cm.nullable() }),
  z.strictObject({ mode: z.literal("unknown") }),
]);
const sizeStep = z.strictObject({ screen: z.literal("size"), size: sizeInput });

const choice = <T extends readonly [string, ...string[]]>(keys: T) => z.enum([...keys, "unknown"], { error: t.chooseOrUnknown });
const facadeChoice = choice(FACADE_KEYS);
const countertopChoice = z.enum([...COUNTERTOP_KEYS, "unknown", "none"], { error: t.chooseOrUnknown });
const hardwareChoice = choice(HARDWARE_KEYS);

/** Блок «Для продвинутых» первого экрана: размеры и материалы, у каждого — «Не знаю — подскажет исполнитель». */
export const advancedSchema = z.strictObject({ size: sizeInput, facade: facadeChoice, countertop: countertopChoice, hardware: hardwareChoice });
export type AdvancedInput = z.output<typeof advancedSchema>;

/** Первый экран (ТЗ п. 3): только тип и стиль; блок «Для продвинутых» — null, если его не открывали. */
const startStep = z
  .strictObject({ screen: z.literal("start"), ...typeFields, style: z.enum(STYLE_KEYS).nullable(), advanced: advancedSchema.nullable().default(null) })
  .refine(oneType, typeRefine);

/** Материалы и фурнитура — не экран мастера: шаг сохраняет то, что распознал помощник ИИ. */
const materialsStep = z.strictObject({
  screen: z.literal("materials"),
  facade: facadeChoice,
  countertop: countertopChoice,
  hardware: hardwareChoice,
  color: optionalText(LIMITS.color),
  extras: z.array(z.enum(EXTRAS)).default([]),
  description: optionalText(LIMITS.description),
});

const segmentStep = z.strictObject({
  screen: z.literal("segment"),
  segment: z.enum(SEGMENTS, { error: t.segmentRequired }),
});

/** Точка адреса (решение 2.2.5): обе координаты или ни одной — как CHECK в БД. Нужна для GPS-проверки сдачи. */
export const geoPointSchema = z.strictObject({
  lat: z.number({ error: t.location }).min(-90, t.location).max(90, t.location),
  lng: z.number({ error: t.location }).min(-180, t.location).max(180, t.location),
});
export type GeoPoint = z.output<typeof geoPointSchema>;

const placeStep = z.strictObject({
  screen: z.literal("place"),
  city: z.string().trim().min(2, t.cityRequired).max(LIMITS.city),
  address: z.string().trim().min(5, t.addressRequired).max(LIMITS.address, t.tooLong(LIMITS.address)),
  desiredDate: z.iso.date(t.date).nullable(),
  location: geoPointSchema.nullable().default(null),
});

/** Проверка и отправка: всё уже сохранено на прошлых экранах. */
const sendStep = z.strictObject({ screen: z.literal("send") });

export const stepInputSchema = z.discriminatedUnion("screen", [
  startStep,
  segmentStep,
  roomStep,
  placeStep,
  sendStep,
  typeStep,
  styleStep,
  sizeStep,
  materialsStep,
]);
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

/** Сумма в целых тенге: цена отклика и торга (на сервере → kztToTiyn), суммы сценариев до договора. */
const money = z.number({ error: t.price }).int(t.price).min(1, t.price).max(100_000_000, t.price);
const MEASUREMENT_TERMS = ["FREE", "INCLUDED", "FEE_IF_NO_DEAL"] as const;

export const sendOfferSchema = z
  .strictObject({
    requestId: id,
    /** Цена отклика в тенге — первое предложение торга; в БД — тиыны. */
    priceKzt: money,
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

/**
 * ФИО и ИИН заказчика — только если их ещё нет. Формат и контрольную цифру проверяет
 * identity.recordPersonIdentity: её ошибки приходят к полям fullName и iin формы.
 */
const clientIdentity = z.strictObject({ fullName: z.string().trim().max(120), iin: z.string().trim().max(20) });
/** Согласие на договор в сценарии до договора (флаг preContractFlows): цена — из замера или проекта. */
export const agreeToContractSchema = z.strictObject({
  requestId: id,
  identity: clientIdentity.optional(),
});

/** Торг (решение 2.2.3): своя цена или встречная — в целых тенге; принять и отозвать — по id предложения. */
export const proposePriceSchema = z.strictObject({ offerId: id, amountKzt: money });
export type ProposePriceInput = z.output<typeof proposePriceSchema>;
export const proposalRefSchema = z.strictObject({ proposalId: id });

/** Номер экрана (с нуля); -1 — шаг не экран мастера (материалы). `Request.wizardStep` — сколько экранов уже сохранено. */
export function screenIndex(screen: StepInput["screen"]): number {
  return (WIZARD_SCREENS as readonly string[]).indexOf(screen);
}

/**
 * Экран, на который открыть мастер: запрошенный в адресе, если он не дальше сохранённого прогресса, иначе последний
 * сохранённый. Черновик прежнего мастера (уровень и адрес раньше сохранялись при отправке) возвращается к экрану,
 * где их не хватает, — иначе отправка упадёт с «заполните все шаги».
 */
export function resumeIndex(
  draft: { wizardStep: number; segment: string | null; address: string | null; typeChosen: boolean } | null,
  asked: string | undefined,
): number {
  if (!draft) return 0;
  let reached = Math.min(draft.wizardStep, WIZARD_SCREENS.length - 1);
  if (!draft.typeChosen) reached = 0;
  if (!draft.segment) reached = Math.min(reached, screenIndex("segment"));
  if (!draft.address) reached = Math.min(reached, screenIndex("place"));
  const index = asked === undefined ? -1 : screenIndex(asked as WizardScreen);
  return index >= 0 && index <= reached ? index : reached;
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

function applySize(d: RequestDetails, size: z.output<typeof sizeInput>): RequestDetails {
  const known = size.mode === "known" ? size : null;
  return compact({
    ...d,
    widthCm: known?.widthCm,
    heightCm: known?.heightCm ?? undefined,
    depthCm: known?.depthCm ?? undefined,
    unknown: withUnknown(d, "size", known === null),
  });
}

/** Фасады, столешница, фурнитура: значение или «не знаю»; столешница может быть не нужна. */
function applyMaterials(d: RequestDetails, m: Pick<AdvancedInput, "facade" | "countertop" | "hardware">): RequestDetails {
  let next: RequestDetails = { ...d, facade: m.facade === "unknown" ? undefined : m.facade, unknown: withUnknown(d, "facade", m.facade === "unknown") };
  next = {
    ...next,
    countertop: m.countertop === "unknown" || m.countertop === "none" ? undefined : m.countertop,
    unknown: withUnknown(next, "countertop", m.countertop === "unknown"),
  };
  next = { ...next, hardware: m.hardware === "unknown" ? undefined : m.hardware, unknown: withUnknown(next, "hardware", m.hardware === "unknown") };
  return compact(next);
}

/** Новые `details` после шага мастера. Шаги без технических полей details не меняют. */
export function applyStep(d: RequestDetails, step: StepInput): RequestDetails {
  switch (step.screen) {
    case "start":
      return step.advanced ? applyMaterials(applySize(d, step.advanced.size), step.advanced) : d;
    case "style":
      return compact({ ...d, styleNote: step.styleNote });
    case "room":
      return compact({ ...d, description: step.description });
    case "size":
      return applySize(d, step.size);
    case "materials":
      return applyMaterials(compact({ ...d, color: step.color, extras: step.extras, description: step.description }), step);
    case "type":
    case "segment":
    case "place":
    case "send":
      return d;
  }
}
