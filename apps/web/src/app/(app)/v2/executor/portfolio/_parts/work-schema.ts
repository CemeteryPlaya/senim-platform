import { z } from "zod";
import { ru } from "@/i18n/ru";
import { STYLES, type StyleKey } from "@/verticals/furniture";

// Работа портфолио мастера (v2): проверка полей формы (без React и сервера). Правила те же, что у `portfolioInputSchema`
// модуля companies, тексты — v2 (`ru.app.masterPortfolio.form.errors`). Всё, что пропускает эта схема, пропускает и
// схема модуля (действие затем разбирает вход схемой модуля); пределы сверяет `actions.int.test.ts` с константами модуля.
// Маска имени и контактов в названии и описании, правило места — у модуля.

const t = ru.app.masterPortfolio.form.errors;

export const TITLE_MIN = 3;
export const TITLE_MAX = 120;
export const DESCRIPTION_MAX = 2000;
export const PLACE_MAX = 80;
export const PRICE_MAX = 1_000_000_000;
export const PHOTOS_MAX = 10;

export const STYLE_KEYS = Object.keys(STYLES) as [StyleKey, ...StyleKey[]];

const id = z.string().min(1).max(64);

const fields = {
  furnitureTypeId: z.string().min(1, t.type),
  style: z.enum(STYLE_KEYS, t.style),
  title: z.string().trim().min(TITLE_MIN, t.title(TITLE_MIN, TITLE_MAX)).max(TITLE_MAX, t.title(TITLE_MIN, TITLE_MAX)),
  description: z.string().trim().max(DESCRIPTION_MAX, t.description(DESCRIPTION_MAX)),
  priceFrom: z.number(t.price).int(t.price).min(0, t.price).max(PRICE_MAX, t.price).nullable(),
  published: z.boolean(),
  place: z.string().trim().max(PLACE_MAX, t.placeLength(PLACE_MAX)),
  /** Фото в порядке на экране: прикрепляются новые, убранные открепляются. */
  fileIds: z.array(id).max(PHOTOS_MAX, t.photos(PHOTOS_MAX)),
};

/** Новая работа: `clientKey` — ключ повтора формы (повтор отдаёт ту же работу, модуль companies). */
export const createWorkSchema = z.strictObject({ ...fields, clientKey: z.uuid().optional() });
export const updateWorkSchema = z.strictObject({ id, ...fields });
export const setPublishedSchema = z.strictObject({ id, published: z.boolean() });
export const deleteWorkSchema = z.strictObject({ id });

export type WorkInput = z.input<typeof createWorkSchema>;
