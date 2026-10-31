import { z } from "zod";
import { ru } from "@/i18n/ru";
import { isValidFullName, normalizeFullName } from "./full-name";
import { binIinKindFor, isValidBinIin, isValidIin } from "./kz-id";

const t = ru.identity.registration.errors;
const digits = z.string().transform((v) => v.replace(/\s/g, ""));

/**
 * Анкета регистрации исполнителя. ИИН/БИН проверяется по форме работы: ТОО — БИН, остальные — ИИН.
 * ТОО подписывает договор ЭЦП директора (представителя): его ФИО и ИИН обязательны, у ИП и самозанятого
 * подписывает владелец — его ИИН и есть ИИН профиля, директор не нужен (director: null).
 */
export const executorRegistrationSchema = z
  .object({
    legalForm: z.enum(["SELF_EMPLOYED", "IP", "TOO"]),
    legalName: z.string().trim().min(2, t.legalName).max(200, t.legalName),
    binIin: digits,
    city: z.string().trim().min(2, t.city).max(100, t.city),
    yearsExperience: z.coerce.number({ error: t.experience }).int(t.experience).min(0, t.experience).max(60, t.experience),
    directorName: z.string().optional(),
    directorIin: digits.optional(),
  })
  .superRefine((v, ctx) => {
    const kind = binIinKindFor(v.legalForm);
    if (!isValidBinIin(kind, v.binIin)) ctx.addIssue({ code: "custom", path: ["binIin"], message: t.binIin[kind] });
    if (v.legalForm !== "TOO") return;
    if (!isValidFullName(v.directorName ?? "")) ctx.addIssue({ code: "custom", path: ["directorName"], message: t.directorName });
    if (!isValidIin(v.directorIin ?? "")) ctx.addIssue({ code: "custom", path: ["directorIin"], message: t.directorIin });
  })
  .transform(({ directorName, directorIin, ...rest }) => ({
    ...rest,
    director: rest.legalForm === "TOO" ? { fullName: normalizeFullName(directorName ?? ""), iin: directorIin ?? "" } : null,
  }));

export type ExecutorRegistrationInput = z.infer<typeof executorRegistrationSchema>;
