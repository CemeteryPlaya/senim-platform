import { z } from "zod";
import { ru } from "@/i18n/ru";
import { MATERIAL_CATEGORIES, MATERIAL_UNITS } from "@/verticals/furniture";
import type { DisputeOutcome } from "@/generated/prisma/enums";
import { resolveDisputeSchema as dealResolveDisputeSchema } from "@/modules/deal-core";
import { binIinKindFor, isValidBin, isValidIin, parsePhone, refineSigner, signerFields, signerOf, type RegistrationDecision } from "@/modules/identity";
import { confirmManualSchema, failManualSchema, kztToTiyn, MAX_PRICE_TIYN } from "@/modules/payments";

/**
 * Входные данные панели оператора. Разбираются один раз на границе (Server Action,
 * route handler); сервисы получают уже проверенные значения.
 * Формы присылают строки: пустая строка = поле не заполнено.
 */

const t = ru.operator.validation;

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optionalText = z.preprocess(emptyToUndefined, z.string().trim().max(200).optional());
const id = z.string().trim().min(1).max(64);

export const segmentSchema = z.enum(["ECONOMY", "COMFORT", "PREMIUM"]);
export const legalFormSchema = z.enum(["SELF_EMPLOYED", "IP", "TOO"]);

// ─── ИИН/БИН и телефон: правила identity (одно место для алгоритма) ─────────

const phoneSchema = z.string().transform((v, ctx) => {
  const phone = parsePhone(v);
  if (phone) return phone;
  ctx.addIssue({ code: "custom", message: t.phone });
  return z.NEVER;
});

const digitsOnly = z
  .string()
  .transform((v) => v.replace(/\s/g, ""))
  .refine((v) => v.length > 0, t.kzIdRequired)
  .refine((v) => v.length === 0 || /^\d{12}$/.test(v), t.kzId);

// ─── исполнители ─────────────────────────────────────────────────────────────

export const reviewRegistrationSchema = z
  .discriminatedUnion("decision", [
    z.object({ profileId: id, decision: z.literal("approve"), segment: segmentSchema }),
    z.object({ profileId: id, decision: z.literal("reject"), reason: z.string().trim().min(5, t.reason).max(500) }),
  ])
  .transform(({ profileId, ...d }) => ({
    profileId,
    decision: (d.decision === "approve" ? { approve: true, segment: d.segment } : { approve: false, reason: d.reason }) as RegistrationDecision,
  }));
export type ReviewRegistrationInput = z.output<typeof reviewRegistrationSchema>;

/**
 * Самозанятый и ИП — ИИН, ТОО — БИН (identity.binIinKindFor). Подписант договора — по тем же правилам,
 * что в анкете исполнителя (identity.refineSigner): ТОО — ФИО и ИИН директора, ИП — ФИО владельца,
 * самозанятый — наименование и есть ФИО.
 */
export const addExecutorSchema = z
  .object({
    phone: phoneSchema,
    legalForm: legalFormSchema,
    legalName: z.string().trim().min(2, t.legalNameRequired).max(200),
    binIin: digitsOnly,
    ...signerFields,
    segment: segmentSchema,
  })
  .superRefine((v, ctx) => {
    if (!(binIinKindFor(v.legalForm) === "IIN" ? isValidIin : isValidBin)(v.binIin)) ctx.addIssue({ code: "custom", path: ["binIin"], message: t.kzId });
    refineSigner(v, ctx);
  })
  .transform(({ ownerName, directorName, directorIin, ...rest }) => ({
    ...rest,
    signer: signerOf({ ...rest, ownerName, directorName, directorIin }),
  }));
export type AddExecutorInput = z.output<typeof addExecutorSchema>;

export const changeSegmentSchema = z
  .object({ profileId: id, from: segmentSchema, to: segmentSchema, reason: z.string().trim().min(5, t.reason).max(500) })
  .refine((v) => v.from !== v.to, { path: ["to"], message: t.sameSegment });
export type ChangeSegmentInput = z.output<typeof changeSegmentSchema>;

// ─── справочник типов мебели ─────────────────────────────────────────────────

const typeName = z.string().trim().min(2, t.name).max(60, t.name);
export const addFurnitureTypeSchema = z.object({ name: typeName });
export const renameFurnitureTypeSchema = z.object({ id, name: typeName });
export const setFurnitureTypeActiveSchema = z.object({ id, active: z.boolean() });
export const moveFurnitureTypeSchema = z.object({ id, direction: z.enum(["up", "down"]) });

// ─── заявки, отчёт ───────────────────────────────────────────────────────────

export const staleRequestsSchema = z.object({ hours: z.coerce.number().int().min(1).max(720).default(24) });
/** staleDays — сколько дней операция manual может ждать банковского документа, прежде чем попасть в расхождения. */
export const reportSchema = z.object({ staleDays: z.coerce.number().int().min(1).max(60).default(3) });
export const CSV_KINDS = ["deals", "operations", "discrepancies"] as const;
export const csvSchema = reportSchema.extend({ kind: z.enum(CSV_KINDS) });
export type CsvKind = (typeof CSV_KINDS)[number];

/** Период отчёта о доходе: даты из <input type="date">, «по» включительно (граница дня по Астане). */
export const incomePeriodSchema = z
  .object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, t.period), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, t.period) })
  .transform(({ from, to }) => ({ from: new Date(`${from}T00:00:00.000+05:00`), to: new Date(new Date(`${to}T00:00:00.000+05:00`).getTime() + 86_400_000) }))
  .refine((p) => p.from < p.to, { message: t.period, path: ["to"] });
export type IncomePeriod = z.output<typeof incomePeriodSchema>;

// ─── споры ───────────────────────────────────────────────────────────────────

export const DISPUTE_OUTCOMES = ["CONTINUE", "FULL_REFUND", "PARTIAL_SPLIT"] as const satisfies readonly DisputeOutcome[];

/** Сумма мастеру Y в целых тенге из поля формы (пробелы между разрядами допустимы); потолок — потолок цены сделки. */
const shareKztRequired = z.preprocess(
  (v) => (typeof v === "string" ? v.replace(/[\s  ]/g, "") : v),
  z.coerce.number({ error: t.amount }).int(t.amount).positive(t.amount).max(Number(MAX_PRICE_TIYN / 100n), t.amount),
);
const shareKzt = z.preprocess(emptyToUndefined, shareKztRequired.optional());

export const splitPreviewSchema = z.object({ disputeId: id, masterShareKzt: shareKztRequired });

/**
 * Форма решения спора → вход deal-core.resolveDispute. Здесь — только разбор полей формы (итог из списка,
 * сумма в тенге → тиыны через kztToTiyn); правила решения (обоснование, сумма только при разделе) — в схеме
 * владельца (deal-core.resolveDisputeSchema), которой форма передаёт результат.
 */
export const resolveDisputeSchema = z
  .object({
    disputeId: id,
    outcome: z.enum(DISPUTE_OUTCOMES, { error: t.outcome }),
    masterShareKzt: shareKzt,
    rationale: z.string(),
  })
  .refine((v) => v.outcome !== "PARTIAL_SPLIT" || v.masterShareKzt !== undefined, { path: ["masterShareKzt"], message: t.amount })
  .transform(({ masterShareKzt, ...v }) => (v.outcome === "PARTIAL_SPLIT" && masterShareKzt !== undefined ? { ...v, masterShareTiyn: kztToTiyn(masterShareKzt) } : v))
  .pipe(dealResolveDisputeSchema);
export type ResolveDisputeFormInput = z.output<typeof resolveDisputeSchema>;

// ─── деньги: подтверждения manual по банковским документам ───────────────────

/**
 * Поля формы подтверждения — схема payments (владелец подтверждения manual) без скана: скан приходит файлом
 * рядом и сохраняется до вызова payments. Дата из <input type="date"> — начало дня по Астане.
 */
export const bankConfirmFieldsSchema = confirmManualSchema.omit({ bankDocFileId: true }).extend({
  bankDocDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, ru.payments.validation.bankDocDate).transform((d) => new Date(`${d}T00:00:00.000+05:00`)),
});
/** «Отклонено банком» — та же схема, что у payments.failManualOperation. */
export const bankFailSchema = failManualSchema;

// ─── KYC ─────────────────────────────────────────────────────────────────────


// ─── журнал аудита ───────────────────────────────────────────────────────────

/** Дата из поля <input type="date"> — граница дня по времени Астаны (UTC+5). */
const astanaDay = (edge: "start" | "end") =>
  z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .transform((d) => new Date(`${d}T${edge === "start" ? "00:00:00.000" : "23:59:59.999"}+05:00`))
      .optional(),
  );

export const auditFilterSchema = z.object({
  /** Номер сделки: вся её история (scope deal:<id>). */
  deal: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().optional()),
  entityType: optionalText,
  entityId: optionalText,
  scope: optionalText,
  action: optionalText,
  actorId: optionalText,
  from: astanaDay("start"),
  to: astanaDay("end"),
  before: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(/^\d{1,18}$/)
      .transform((v) => BigInt(v))
      .optional(),
  ),
});
export type AuditFilterInput = z.output<typeof auditFilterSchema>;

// ─── справочник цен материалов (ADR-007) ─────────────────────────────────────

const m = ru.materials.validation;

/** Целые тенге из поля формы: пробелы между разрядами допустимы, копейки — нет. */
const tenge = z.preprocess(
  (v) => (typeof v === "string" ? v.replace(/[\s  ]/g, "") : v),
  z.coerce.number({ error: m.price }).int(m.price).min(1, m.price).max(100_000_000, m.price),
);

/** Флажки уровней приходят из формы полями `segment_<УРОВЕНЬ>`; сервисы и тесты передают массив `segments`. */
const segmentsFromForm = (v: unknown) => {
  if (!v || typeof v !== "object" || "segments" in v) return v;
  const fields = v as Record<string, unknown>;
  return { ...fields, segments: segmentSchema.options.filter((s) => typeof fields[`segment_${s}`] === "string" && fields[`segment_${s}`] !== "") };
};

export const addMaterialPriceSchema = z.preprocess(
  segmentsFromForm,
  z.object({
    category: z.enum(MATERIAL_CATEGORIES, { error: m.category }),
    name: z.string().trim().min(2, m.name).max(80, m.name),
    unit: z.enum(MATERIAL_UNITS, { error: m.unit }),
    priceKzt: tenge,
    segments: z.array(segmentSchema).min(1, m.segments),
  }),
);
export type AddMaterialPriceInput = z.output<typeof addMaterialPriceSchema>;

/** `from` — цена, которую видел оператор: если её уже изменили, сохранение не перезапишет чужое. */
export const changeMaterialPriceSchema = z
  .object({ id, from: tenge, to: tenge })
  .refine((v) => v.from !== v.to, { path: ["to"], message: m.price });
export type ChangeMaterialPriceInput = z.output<typeof changeMaterialPriceSchema>;

export const setMaterialPriceActiveSchema = z.object({ id, active: z.boolean() });
