import { z } from "zod";
import { ru } from "@/i18n/ru";
import { binIinKindFor, isValidBin, isValidIin, parsePhone, refineSigner, signerFields, signerOf, type RegistrationDecision } from "@/modules/identity";

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
export const reportSchema = z.object({ staleDays: z.coerce.number().int().min(1).max(60).default(3) });
export const CSV_KINDS = ["deals", "stages", "payments", "discrepancies", "reconciliation"] as const;
export const csvSchema = reportSchema.extend({ kind: z.enum(CSV_KINDS) });
export type CsvKind = (typeof CSV_KINDS)[number];

// ─── споры ───────────────────────────────────────────────────────────────────

export const DISPUTE_DECISIONS = ["FAVOR_CLIENT", "FAVOR_EXECUTOR", "PARTIAL", "TERMINATE"] as const;

export const resolveDisputeSchema = z
  .object({
    disputeId: id,
    decision: z.enum(DISPUTE_DECISIONS),
    decisionAmount: z.preprocess(emptyToUndefined, z.coerce.number().int().positive(t.amount).optional()),
    rationale: z.string().trim().min(10, t.rationale).max(2000),
  })
  .refine((v) => v.decision !== "PARTIAL" || v.decisionAmount !== undefined, { path: ["decisionAmount"], message: t.amount })
  .transform(({ decisionAmount, ...v }) => (v.decision === "PARTIAL" ? { ...v, decisionAmount } : v));

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

// ─── демо ────────────────────────────────────────────────────────────────────

/** Режимы, которые оператор может включить для новых сделок в демо (bank — только через env). */
export const DEMO_RAIL_MODES = ["manual", "escrow-simulator"] as const;
export const paymentRailSchema = z.object({ mode: z.enum(DEMO_RAIL_MODES) });
export type DemoRailMode = (typeof DEMO_RAIL_MODES)[number];
