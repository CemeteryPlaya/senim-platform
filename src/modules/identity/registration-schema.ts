import { z } from "zod";
import { ru } from "@/i18n/ru";
import { binIinKindFor, isValidBinIin } from "./kz-id";

const t = ru.identity.registration.errors;

/** Анкета регистрации исполнителя. ИИН/БИН проверяется по форме работы: ТОО — БИН, остальные — ИИН. */
export const executorRegistrationSchema = z
  .object({
    legalForm: z.enum(["SELF_EMPLOYED", "IP", "TOO"]),
    legalName: z.string().trim().min(2, t.legalName).max(200, t.legalName),
    binIin: z.string().transform((v) => v.replace(/\s/g, "")),
    city: z.string().trim().min(2, t.city).max(100, t.city),
    yearsExperience: z.coerce.number({ error: t.experience }).int(t.experience).min(0, t.experience).max(60, t.experience),
  })
  .superRefine((v, ctx) => {
    const kind = binIinKindFor(v.legalForm);
    if (!isValidBinIin(kind, v.binIin)) ctx.addIssue({ code: "custom", path: ["binIin"], message: t.binIin[kind] });
  });

export type ExecutorRegistrationInput = z.infer<typeof executorRegistrationSchema>;
