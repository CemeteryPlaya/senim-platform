import { z } from "zod";
import { DisputeOutcome, DisputeReason } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { MAX_PRICE_TIYN } from "@/modules/payments";

/**
 * Входы deal-core. Те же схемы использует action() на экранах; сервис тоже разбирает вход,
 * потому что его вызывают и другие модули (requests, operator, documents).
 */

const v = ru.deal.validation;
export const id = z.string().trim().min(1, v.badRef).max(64, v.badRef);
const text = (min: number, max: number, tooShort: string) => z.string().trim().min(min, tooShort).max(max, v.tooLong(max));
const photos = (min: number, tooFew: string) => z.array(id).min(min, tooFew).max(12, v.tooManyPhotos(12));
/** Тиыны: bigint или строка цифр (формы и JSON не передают bigint). */
export const tiyn = z.union([z.bigint(), z.string().regex(/^\d{1,15}$/).transform(BigInt)]);

export const dealRefSchema = z.object({ dealId: id });

export const createDealSchema = z.object({
  requestId: id,
  offerId: id,
  /** Цена X по итогу торга (принятое PriceProposal или цена отклика), тиыны. */
  priceTiyn: tiyn.refine((x) => x > 0n && x <= MAX_PRICE_TIYN, v.price),
  title: text(1, 200, v.title),
});

/** Сдача: фото результата обязательно; координаты — пара или ничего (браузер мог не дать геолокацию). */
export const submitReadySchema = z
  .object({
    dealId: id,
    photoIds: photos(1, v.deliveryPhotos),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    // Браузер может вернуть грубую точность (километры): не отказываем в сдаче, а ограничиваем 100 км.
    accuracyM: z.number().int().min(0).transform((m) => Math.min(m, 100_000)).optional(),
  })
  .refine((x) => (x.lat === undefined) === (x.lng === undefined), { message: v.coordsPair, path: ["lat"] });

export const progressReportSchema = z.object({
  dealId: id,
  title: z.string().trim().max(120, v.tooLong(120)).default(""),
  text: text(2, 2000, v.progressText),
  photoIds: photos(0, v.deliveryPhotos).default([]),
});

export const cancelDealSchema = z.object({ dealId: id, reason: z.string().trim().max(500, v.tooLong(500)).default("") });

export const openDisputeSchema = z.object({
  dealId: id,
  reason: z.enum(DisputeReason),
  description: text(10, 2000, v.disputeDescription),
  photoIds: photos(0, v.deliveryPhotos).default([]),
});

export const disputePositionSchema = z.object({ disputeId: id, position: text(10, 2000, v.disputePosition) });

/** Решение спора (ADR-009 раздел 3): доля мастера Y — только при частичном разделе, 0 < Y ≤ X. */
export const resolveDisputeSchema = z
  .object({
    disputeId: id,
    outcome: z.enum(DisputeOutcome),
    masterShareTiyn: tiyn.optional(),
    rationale: text(10, 2000, v.rationale),
  })
  .refine((x) => (x.outcome === "PARTIAL_SPLIT") === (x.masterShareTiyn !== undefined), { message: v.shareOnlyPartial, path: ["masterShareTiyn"] });

export const reviewSchema = z.object({
  dealId: id,
  rating: z.number().int().min(1, v.rating).max(5, v.rating),
  text: z.string().trim().max(2000, v.tooLong(2000)).default(""),
  portfolioConsent: z.boolean().default(false),
});
