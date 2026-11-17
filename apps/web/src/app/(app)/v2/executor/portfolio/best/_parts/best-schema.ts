import { z } from "zod";
import { ru } from "@/i18n/ru";
import { HIGHLIGHTS_MAX } from "@/modules/companies";

const t = ru.app.masterPortfolio.best.errors;
const id = z.string().min(1).max(64);

const ref = z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("work"), id }), z.strictObject({ kind: z.literal("deal"), id })]);

/**
 * «Сохранить» лучшие работы: набор целиком по порядку (замена, повтор безопасен). `clientKey` — ключ повтора формы;
 * набор заменяется целиком, поэтому повтор с тем же содержимым ничего не меняет. Правила выбора проверяет модуль.
 */
export const bestSchema = z
  .strictObject({ items: z.array(ref).max(HIGHLIGHTS_MAX, t.tooMany(HIGHLIGHTS_MAX)), clientKey: z.uuid().optional() })
  .refine((v) => new Set(v.items.map((i) => `${i.kind}:${i.id}`)).size === v.items.length, { message: t.changed, path: ["items"] });
