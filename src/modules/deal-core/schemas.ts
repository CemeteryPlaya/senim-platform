import { z } from "zod";
import { DisputeDecision, DisputeReason } from "@/generated/prisma/enums";
import { fail } from "@/platform/errors";

/**
 * Входы deal-core. Те же схемы использует action() на экранах; сервис тоже разбирает вход,
 * потому что его вызывают и другие модули (requests, operator), и задачи.
 */

const id = z.string().trim().min(1).max(64);
const text = (min: number, max: number, tooShort: string) =>
  z.string().trim().min(min, tooShort).max(max, `Не больше ${max} символов`);

export const stageRefSchema = z.object({ stageId: id });
export const dealRefSchema = z.object({ dealId: id });

export const submitStageSchema = z.object({
  stageId: id,
  report: text(5, 2000, "Опишите, что сделано на этапе"),
  photoIds: z.array(id).min(1, "Добавьте хотя бы одно фото этапа").max(12, "Не больше 12 фото"),
});

export const reworkSchema = z.object({ stageId: id, note: text(5, 1000, "Опишите, что нужно исправить") });

export const cancelDealSchema = z.object({ dealId: id, reason: z.string().trim().max(500).default("") });

export const openDisputeSchema = z.object({
  dealId: id,
  reason: z.enum(DisputeReason),
  description: text(10, 3000, "Опишите ситуацию подробнее — хотя бы 10 символов"),
  attachmentIds: z.array(id).max(10).default([]),
});

export const disputePositionSchema = z.object({
  disputeId: id,
  position: text(10, 3000, "Опишите позицию подробнее — хотя бы 10 символов"),
});

export const resolveDisputeSchema = z.object({
  disputeId: id,
  decision: z.enum(DisputeDecision),
  decisionAmount: z.number().int().positive().optional(),
  rationale: text(10, 3000, "Обоснуйте решение — хотя бы 10 символов"),
});

export const reviewSchema = z.object({
  dealId: id,
  rating: z.coerce.number().int().min(1, "Оценка от 1 до 5").max(5, "Оценка от 1 до 5"),
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

export const autoAcceptPayloadSchema = z.object({ stageId: id, submittedAt: z.iso.datetime() });
export const settlePayloadSchema = z.object({ idempotencyKey: z.string().min(1) });
export const dealPayloadSchema = z.object({ dealId: id });

/** Разбор входа сервиса: ошибка — VALIDATION с первым понятным сообщением. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return fail.validation(parsed.error.issues[0]?.message ?? "Проверьте заполнение полей");
  return parsed.data;
}
