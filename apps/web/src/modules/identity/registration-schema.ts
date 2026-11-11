import { z } from "zod";
import type { LegalForm } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { isValidFullName, normalizeFullName } from "./full-name";
import { isValidBin, isValidIin } from "./kz-id";

const t = ru.identity.registration.errors;
const a = ru.companies.address.errors;
const DISTRICT_MAX = 100;
const STREET_MAX = 200;
const digits = z.string().transform((v) => v.replace(/\s/g, ""));

/**
 * Подписант договора от исполнителя — свойство профиля, а не аккаунта (ADR-003):
 *  - ТОО — директор (представитель): ФИО и ИИН из анкеты, iin — его ИИН;
 *  - ИП — владелец: ФИО из анкеты (наименование ИП бывает фирменным — «ИП «Дала»», ФИО из него не извлечь);
 *  - самозанятый — он сам: наименование профиля и есть его ФИО.
 * У ИП и самозанятого iin: null — подписывают ИИН профиля (ИИН/БИН), он и есть ИИН владельца.
 */
export type ExecutorSigner = { fullName: string; iin: string | null };

/**
 * Адрес мастерской или офиса (№6) — общие поля анкеты и профиля (companies): город обязателен,
 * район и улица — нет. Что из адреса видит заказчик, решает companies.executorDisplay.
 */
export const addressFields = {
  city: z.string().trim().min(2, t.city).max(100, t.city),
  district: z.string().trim().max(DISTRICT_MAX, a.district(DISTRICT_MAX)).optional(),
  streetAddress: z.string().trim().max(STREET_MAX, a.street(STREET_MAX)).optional(),
};

/** Поля анкеты о подписанте. Формы присылают все; нужные форме работы проверяет refineSigner. */
export const signerFields = {
  ownerName: z.string().max(200).optional(),
  directorName: z.string().max(200).optional(),
  directorIin: digits.optional(),
};

type SignerSource = { legalForm: LegalForm; legalName: string; ownerName?: string; directorName?: string; directorIin?: string };
type Issue = { path: string[]; message: string };

function signerIssues(v: SignerSource): Issue[] {
  switch (v.legalForm) {
    case "SELF_EMPLOYED":
      return isValidFullName(v.legalName) ? [] : [{ path: ["legalName"], message: t.selfEmployedName }];
    case "IP":
      return isValidFullName(v.ownerName ?? "") ? [] : [{ path: ["ownerName"], message: t.ownerName }];
    case "TOO":
      return [
        ...(isValidFullName(v.directorName ?? "") ? [] : [{ path: ["directorName"], message: t.directorName }]),
        ...(isValidIin(v.directorIin ?? "")
          ? []
          : [{ path: ["directorIin"], message: v.directorIin ? t.directorIin : t.directorIinRequired }]),
      ];
  }
}

/** Проверка подписанта по форме работы (анкета исполнителя и добавление оператором): ошибки — к полям формы. */
export function refineSigner(v: SignerSource, ctx: { addIssue: (issue: { code: "custom"; path: string[]; message: string }) => void }): void {
  for (const issue of signerIssues(v)) ctx.addIssue({ code: "custom", ...issue });
}

/** Подписант из проверенной анкеты (после refineSigner). */
export function signerOf(v: SignerSource): ExecutorSigner {
  switch (v.legalForm) {
    case "SELF_EMPLOYED":
      return { fullName: normalizeFullName(v.legalName), iin: null };
    case "IP":
      return { fullName: normalizeFullName(v.ownerName ?? ""), iin: null };
    case "TOO":
      return { fullName: normalizeFullName(v.directorName ?? ""), iin: v.directorIin ?? "" };
  }
}

/**
 * Анкета регистрации исполнителя. Номер вводит только ТОО — свой БИН. ИП и самозанятый работают по ИИН владельца
 * аккаунта, указанному при знакомстве (№26, Ruling U): второй раз его не вводят, identity берёт ИИН личности сам —
 * присланный формой номер не читается, binIin у них пуст.
 */
export const executorRegistrationSchema = z
  .object({
    legalForm: z.enum(["SELF_EMPLOYED", "IP", "TOO"]),
    legalName: z.string().trim().min(2, t.legalName).max(200, t.legalName),
    binIin: digits.optional(),
    ...addressFields,
    yearsExperience: z.coerce.number({ error: t.experience }).int(t.experience).min(0, t.experience).max(60, t.experience),
    ...signerFields,
  })
  .superRefine((v, ctx) => {
    if (v.legalForm === "TOO" && !isValidBin(v.binIin ?? "")) ctx.addIssue({ code: "custom", path: ["binIin"], message: v.binIin ? t.bin : t.binRequired });
    refineSigner(v, ctx);
  })
  .transform(({ ownerName, directorName, directorIin, binIin, ...rest }) => ({
    ...rest,
    binIin: rest.legalForm === "TOO" ? (binIin ?? "") : "",
    signer: signerOf({ ...rest, ownerName, directorName, directorIin }),
  }));

export type ExecutorRegistrationInput = z.infer<typeof executorRegistrationSchema>;

