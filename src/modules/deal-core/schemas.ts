import { z } from "zod";
import { DisputeDecision, DisputeReason } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { fail } from "@/platform/errors";

/**
 * Входы deal-core. Те же схемы использует action() на экранах; сервис тоже разбирает вход,
 * потому что его вызывают и другие модули (requests, operator), и задачи.
 */

const v = ru.deal.validation;
const id = z.string().trim().min(1).max(64);
const text = (min: number, max: number, tooShort: string) =>
  z.string().trim().min(min, tooShort).max(max, v.tooLong(max));

export const stageRefSchema = z.object({ stageId: id });
export const dealRefSchema = z.object({ dealId: id });

export const submitStageSchema = z.object({
  stageId: id,
  report: text(5, 2000, v.stageReport),
  photoIds: z.array(id).min(1, v.stagePhotos).max(12, v.tooManyPhotos(12)),
});

export const reworkSchema = z.object({ stageId: id, note: text(5, 1000, v.reworkNote) });

export const cancelDealSchema = z.object({ dealId: id, reason: z.string().trim().max(500).default("") });

export const openDisputeSchema = z.object({
  dealId: id,
  reason: z.enum(DisputeReason),
  description: text(10, 3000, v.disputeDescription),
  attachmentIds: z.array(id).max(10).default([]),
});

export const disputePositionSchema = z.object({
  disputeId: id,
  position: text(10, 3000, v.disputePosition),
});

export const resolveDisputeSchema = z.object({
  disputeId: id,
  decision: z.enum(DisputeDecision),
  decisionAmount: z.number().int().positive().optional(),
  rationale: text(10, 3000, v.rationale),
});

export const reviewSchema = z.object({
  dealId: id,
  rating: z.coerce.number().int().min(1, v.rating).max(5, v.rating),
  text: z.string().trim().max(2000).default(""),
});

const stageTemplateSchema = z.object({
  key: z.string().min(1),
  name: z.string(),
  description: z.string(),
  stages: z
    .array(
      z.object({
        title: z.string().min(1),
        description: z.string(),
        sharePercent: z.number().int().min(0).max(100),
        paymentDue: z.enum(["ON_START", "ON_ACCEPTANCE"]),
      }),
    )
    .min(1),
});

export const createDealSchema = z.object({
  requestId: id,
  offerId: id,
  clientId: id,
  executorId: id,
  title: z.string().trim().min(1).max(200),
  totalAmount: z.number().int().positive().max(1_000_000_000),
  template: stageTemplateSchema,
});

export const autoAcceptPayloadSchema = z.object({
  stageId: id,
  submittedAt: z.iso.datetime(),
  /** Задача поставлена заново после решения спора (срок — от решения). */
  resumedAt: z.iso.datetime().optional(),
});
export const settlePayloadSchema = z.object({ idempotencyKey: z.string().min(1) });
export const dealPayloadSchema = z.object({ dealId: id });

/** Разбор входа сервиса: ошибка — VALIDATION с первым понятным сообщением. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return fail.validation(parsed.error.issues[0]?.message ?? ru.common.errors.invalid);
  return parsed.data;
}
