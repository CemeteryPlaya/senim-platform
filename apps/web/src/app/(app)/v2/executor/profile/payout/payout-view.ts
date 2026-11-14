import { z } from "zod";
import { ru } from "@/i18n/ru";
import { normalizeIban, parseKzIban } from "@/modules/identity/client";

// Счёт для оплаты: проверка номера (в браузере и на сервере одни правила) и что показывает экран. Полный номер на экран
// не возвращается никогда: после сохранения остаются только последние 4 знака.

const t = ru.app.masterCompany.payout;
const errors = t.form.errors;

/** Текст ошибки номера по правилам модуля identity (формат, контрольная сумма) или null, если номер верный. */
export function ibanProblem(raw: string): string | null {
  if (normalizeIban(raw) === "") return errors.empty;
  const check = parseKzIban(raw);
  return check.ok ? null : errors[check.reason];
}

/** Вход действия: номер как ввели (пробелы и регистр не важны); результат — нормализованный верный IBAN. */
export const payoutSchema = z.strictObject({
  iban: z.string().max(64, errors.format).transform((raw, ctx) => {
    const problem = ibanProblem(raw);
    if (problem === null) return normalizeIban(raw);
    ctx.addIssue({ code: "custom", message: problem });
    return z.NEVER;
  }),
});

export type PayoutInput = z.input<typeof payoutSchema>;

export type PayoutNow = { title: string; body: string; next?: string };

/** Карточка «Сейчас / Дальше»: оплата в обработке — смена закрыта; иначе по тому, указан ли счёт. */
export function payoutNow(last4: string | null, locked: boolean): PayoutNow {
  if (locked) return { ...t.now.locked };
  if (last4 === null) return { ...t.now.none };
  return { ...t.now.set };
}

/** Строка «Счёт»: последние 4 знака или «Не указан». */
export const accountLine = (last4: string | null): string => (last4 === null ? t.none : t.masked(last4));
