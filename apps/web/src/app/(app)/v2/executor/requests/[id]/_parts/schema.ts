import { z } from "zod";
import { ru } from "@/i18n/ru";

const t = ru.app.masterOffer.errors;

/** Потолок цены в тенге — как у `money` в схеме модуля requests (sendOfferSchema, proposePriceSchema); совпадение держит schema.test.ts. */
export const MAX_PRICE_KZT = 100_000_000;
/** Срок и гарантия — границы схемы модуля (`sendOfferSchema`). */
export const DAYS = { min: 1, max: 365 } as const;
export const WARRANTY = { min: 0, max: 120 } as const;
export const COMMENT_MAX = 1000;

const id = z.string().min(1).max(64);

/** Пробелы между разрядами («1 200 000»): `\s` в JS покрывает и неразрывный, и узкий неразрывный пробел. */
const GROUP_SEPARATORS = /\s/g;

/**
 * Целое число из поля формы в границах `[min, max]`. Разделители разрядов убираются; остаться должны только цифры (никаких
 * запятых, точек и минусов — «12,5» не превращается молча в 125). Текст ошибки — у поля.
 */
const wholeNumber = (min: number, max: number, message: string, maxMessage = message) =>
  z
    .string()
    .max(32, message)
    .transform((raw) => raw.replace(GROUP_SEPARATORS, ""))
    .pipe(z.string().regex(/^\d+$/, message))
    .transform(Number)
    .pipe(z.number().min(min, message).max(max, maxMessage).int(message));

/** Цена в целых тенге (тиыны считает модуль). */
export const priceKzt = wholeNumber(1, MAX_PRICE_KZT, t.price, t.priceMax);

/**
 * Цена из поля, как её понимает форма до отправки (живой расчёт «Вы получите»): та же схема, что на сервере; не цена —
 * `null`. Чистая функция без текстов.
 */
export function parsePriceKzt(raw: string): number | null {
  const parsed = priceKzt.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** «Отправить предложение»: цена, срок, гарантия, комментарий. Условий замера нет — путь ТЗ (сценарии до оферты не переносятся). */
export const sendSchema = z.strictObject({
  requestId: id,
  price: priceKzt,
  days: wholeNumber(DAYS.min, DAYS.max, t.days),
  warranty: wholeNumber(WARRANTY.min, WARRANTY.max, t.warranty),
  comment: z.string().trim().max(COMMENT_MAX, t.comment).default(""),
});

/** «Предложить свою цену»: предложение и сумма в тенге. */
export const proposeSchema = z.strictObject({ offerId: id, amount: priceKzt });

/** «Принять»: именно то предложение цены покупателя, что было на экране, и предложение мастера — для проверки и повтора. */
export const acceptSchema = z.strictObject({ offerId: id, proposalId: id });

/** «Отозвать мою цену»: своё открытое предложение цены и предложение мастера — для проверки повтора. */
export const withdrawPriceSchema = z.strictObject({ offerId: id, proposalId: id });

/** «Отказаться от заявки»: своё предложение целиком. */
export const withdrawOfferSchema = z.strictObject({ offerId: id });
