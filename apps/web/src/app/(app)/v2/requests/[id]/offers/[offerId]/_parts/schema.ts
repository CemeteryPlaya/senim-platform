import { z } from "zod";
import { ru } from "@/i18n/ru";

const t = ru.app.offer.errors;

/** Потолок цены в тенге — как у `money` в схеме модуля requests (proposePriceSchema); совпадение держит schema.test.ts. */
export const MAX_PRICE_KZT = 100_000_000;

const id = z.string().min(1).max(64);

/** Пробелы между разрядами («1 200 000»): `\s` в JS покрывает и неразрывный, и узкий неразрывный пробел (schema.test.ts). */
const GROUP_SEPARATORS = /\s/g;

/**
 * Цена из поля формы → целые тенге. Разделители разрядов убираются; остаться должны только цифры (никаких запятых,
 * точек и минусов — «12,5» не превращается молча в 125). Границы — 1…MAX_PRICE_KZT, текст ошибки у поля.
 */
export const amountKzt = z
  .string()
  .max(32, t.amount)
  .transform((raw) => raw.replace(GROUP_SEPARATORS, ""))
  .pipe(z.string().regex(/^\d+$/, t.amount))
  .transform(Number)
  .pipe(z.number().min(1, t.amount).max(MAX_PRICE_KZT, t.amountMax).int(t.amount));

/** «Предложить свою цену»: отклик и сумма в тенге (тиыны считает модуль). */
export const proposeSchema = z.strictObject({ offerId: id, amount: amountKzt });

/** «Принять»: именно то предложение цены, что было на экране (`proposalId`), и его отклик — для проверки и повтора. */
export const acceptSchema = z.strictObject({ offerId: id, proposalId: id });

/** «Отозвать предложение»: своё открытое предложение цены. */
export const withdrawSchema = z.strictObject({ proposalId: id });
