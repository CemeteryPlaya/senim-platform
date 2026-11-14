import { z } from "zod";
import { ru } from "@/i18n/ru";

// Компания мастера v2: проверка полей формы (без React и сервера). Правила те же, что у `profileInputSchema` модуля
// companies, тексты — v2 (`ru.app.masterCompany.company.form.errors`). Всё, что пропускает эта схема, пропускает и схема
// модуля (действие затем разбирает вход схемой модуля); пределы сверяет `actions.int.test.ts` с константами модуля.

const t = ru.app.masterCompany.company.form.errors;

export const ABOUT_MAX = 2000;
export const FEE_MIN = 1_000;
export const FEE_MAX = 200_000;
export const DISTRICT_MAX = 100;
export const STREET_MAX = 200;
export const SPECIALIZATIONS_MAX = 30;

export const MEASUREMENT_TERMS = ["FREE", "INCLUDED", "FEE_IF_NO_DEAL"] as const;
export type MeasurementTerms = (typeof MEASUREMENT_TERMS)[number];

export const companySchema = z
  .strictObject({
    about: z.string().trim().max(ABOUT_MAX, t.aboutTooLong(ABOUT_MAX)),
    yearsExperience: z.number(t.experience).int(t.experience).min(0, t.experience).max(60, t.experience),
    specializationIds: z.array(z.string().min(1)).max(SPECIALIZATIONS_MAX, t.specializations),
    measurementTerms: z.enum(MEASUREMENT_TERMS),
    measurementFee: z.number().int().nullable(),
    city: z.string().trim().min(2, t.city).max(100, t.city),
    district: z.string().trim().max(DISTRICT_MAX, t.district(DISTRICT_MAX)),
    streetAddress: z.string().trim().max(STREET_MAX, t.street(STREET_MAX)),
  })
  .superRefine((v, ctx) => {
    if (v.measurementTerms !== "FEE_IF_NO_DEAL") return;
    const fee = v.measurementFee;
    if (fee === null || fee < FEE_MIN || fee > FEE_MAX) ctx.addIssue({ code: "custom", path: ["measurementFee"], message: t.fee(FEE_MIN, FEE_MAX) });
  });

export type CompanyInput = z.input<typeof companySchema>;

/** Число из поля ввода: пробелы-разделители (в том числе неразрывные) допустимы, пустое поле — null. */
export function toNumber(raw: string): number | null {
  const clean = raw.replace(/[\s ]/g, "");
  return clean === "" ? null : Number(clean);
}
