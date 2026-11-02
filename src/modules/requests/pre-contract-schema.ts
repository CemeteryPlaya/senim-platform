import { z } from "zod";
import { ru } from "@/i18n/ru";
import { LIMITS } from "./schema";

/**
 * Входы шагов до договора (ADR-005): проект, залог, замер площадки, повторный отклик.
 * Без server-only: формы проверяют ввод теми же схемами, что и Server Actions.
 */

const t = ru.requests.validation;
const pe = ru.requests.pre.errors;

const id = z.string().min(1).max(64);
const money = z.number({ error: t.price }).int(t.price).min(1, t.price).max(100_000_000, t.price);
const cm = z.number({ error: t.size }).int(t.size).min(LIMITS.cmMin, t.size).max(LIMITS.cmMax, t.size);

export const costLineSchema = z.strictObject({
  title: z.string().trim().min(2, pe.lineTitle).max(120, pe.lineTitle),
  amount: money,
});
export type CostLine = z.output<typeof costLineSchema>;
export const costLinesSchema = z.array(costLineSchema).min(1, pe.linesRequired).max(30);

export const sumLines = (lines: readonly { amount: number }[]) => lines.reduce((s, l) => s + l.amount, 0);

export const submitProjectSchema = z
  .strictObject({
    offerId: id,
    materials: z.string().trim().min(3, pe.materials).max(2000, t.tooLong(2000)),
    costLines: costLinesSchema,
    durationDays: z.number({ error: t.days }).int(t.days).min(1, t.days).max(365, t.days),
    warrantyMonths: z.number({ error: t.warranty }).int(t.warranty).min(0, t.warranty).max(120, t.warranty),
    totalPrice: money,
  })
  .refine((p) => p.totalPrice === sumLines(p.costLines), { message: pe.totalMismatch, path: ["totalPrice"] });
export type SubmitProjectInput = z.output<typeof submitProjectSchema>;

export const projectRefSchema = z.strictObject({ projectId: id });
export const requestProjectChangesSchema = z.strictObject({
  projectId: id,
  comment: z.string().trim().min(3, pe.comment).max(1000, t.tooLong(1000)),
});

export const depositRefSchema = z.strictObject({ offerId: id });

export const assignSiteMeasurerSchema = z.strictObject({ requestId: id, measurerId: id });
export const completeSiteMeasurementSchema = z.strictObject({
  siteMeasurementId: id,
  widthCm: cm,
  heightCm: cm,
  depthCm: cm.nullable(),
  notes: z.string().trim().max(1000, t.tooLong(1000)).default(""),
  photoFileIds: z.array(id).max(LIMITS.photos).default([]),
});
export type CompleteSiteMeasurementInput = z.output<typeof completeSiteMeasurementSchema>;

export const allowOfferRetrySchema = z.strictObject({
  requestId: id,
  executorId: id,
  reason: z.string().trim().min(3, pe.reason).max(300, t.tooLong(300)),
});
