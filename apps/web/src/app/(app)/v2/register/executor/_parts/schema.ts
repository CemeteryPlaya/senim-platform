import { z } from "zod";
import { ru } from "@/i18n/ru";
import { isValidBin, isValidFullName, isValidIin } from "@/modules/identity/client";

// Анкета мастера v2: поля, шаги и проверка (без React и сервера — её берут и форма в браузере, и действие на сервере).
// Правила те же, что у схемы модуля (`executorRegistrationSchema`), тексты — v2 (`ru.app.masterRegister.errors`); всё, что
// пропускает эта схема, пропускает и схема модуля (schema.test.ts сверяет обе).

const t = ru.app.masterRegister.errors;

export const LEGAL_FORMS = ["SELF_EMPLOYED", "IP", "TOO"] as const;
export type LegalForm = (typeof LEGAL_FORMS)[number];

export const isLegalForm = (value: string): value is LegalForm => (LEGAL_FORMS as readonly string[]).includes(value);

/** Шаги анкеты по порядку: как работаете → название и подписант → где работаете и опыт → проверка и отправка. */
export const STEPS = ["form", "name", "place", "check"] as const;
export type RegisterStep = (typeof STEPS)[number];

/** Анкета так, как её держит форма: все поля — строки (пустая строка — не указано). */
export type Answers = {
  legalForm: LegalForm | "";
  legalName: string;
  /** БИН — только у ТОО. */
  binIin: string;
  /** ФИО владельца — только у ИП. */
  ownerName: string;
  /** ФИО и ИИН директора — только у ТОО. */
  directorName: string;
  directorIin: string;
  city: string;
  district: string;
  streetAddress: string;
  yearsExperience: string;
};

export type AnswerField = keyof Answers;

/** Поля шагов в порядке на экране: по нему ищется шаг и поле первой ошибки. */
export const STEP_FIELDS: Readonly<Record<Exclude<RegisterStep, "check">, readonly AnswerField[]>> = {
  form: ["legalForm"],
  name: ["legalName", "binIin", "ownerName", "directorName", "directorIin"],
  place: ["city", "district", "streetAddress", "yearsExperience"],
};

export type Issue = { field: AnswerField; message: string };

/** Пробелы внутри номера не считаются: «870304 300 612» — 12 цифр (как в схеме модуля). */
export const digitsOf = (value: string): string => value.replace(/\s/g, "");

const DISTRICT_MAX = 100;
const STREET_MAX = 200;

/** Подписант по форме работы: самозанятый — он сам (наименование и есть ФИО), ИП — владелец, ТОО — директор. */
function signerIssues(a: Answers): Issue[] {
  switch (a.legalForm) {
    case "SELF_EMPLOYED":
      return isValidFullName(a.legalName) ? [] : [{ field: "legalName", message: t.selfEmployedName }];
    case "IP":
      return isValidFullName(a.ownerName) ? [] : [{ field: "ownerName", message: t.ownerName }];
    case "TOO": {
      const iin = digitsOf(a.directorIin);
      return [
        ...(isValidFullName(a.directorName) ? [] : [{ field: "directorName" as const, message: t.directorName }]),
        ...(isValidIin(iin) ? [] : [{ field: "directorIin" as const, message: iin ? t.directorIin : t.directorIinRequired }]),
      ];
    }
    case "":
      return [];
  }
}

function nameIssues(a: Answers): Issue[] {
  const legalName = a.legalName.trim();
  const bin = digitsOf(a.binIin);
  const binIssues: Issue[] = a.legalForm === "TOO" && !isValidBin(bin) ? [{ field: "binIin", message: bin ? t.bin : t.binRequired }] : [];
  // Длина наименования — первой: подписанта самозанятого по тому же полю проверять уже незачем.
  const nameLength: Issue[] = legalName.length < 2 || legalName.length > 200 ? [{ field: "legalName", message: t.legalName }] : [];
  const signer = nameLength.length > 0 ? signerIssues(a).filter((issue) => issue.field !== "legalName") : signerIssues(a);
  return [...nameLength, ...binIssues, ...signer];
}

function placeIssues(a: Answers): Issue[] {
  const city = a.city.trim();
  const experience = a.yearsExperience.trim();
  return [
    ...(city.length < 2 || city.length > 100 ? [{ field: "city" as const, message: t.city }] : []),
    ...(a.district.trim().length > DISTRICT_MAX ? [{ field: "district" as const, message: t.district }] : []),
    ...(a.streetAddress.trim().length > STREET_MAX ? [{ field: "streetAddress" as const, message: t.street }] : []),
    ...(/^\d{1,2}$/.test(experience) && Number(experience) <= 60 ? [] : [{ field: "yearsExperience" as const, message: t.experience }]),
  ];
}

/** Ошибки одного шага (у проверки — всех шагов) в порядке полей на экране. */
export function stepIssues(step: RegisterStep, a: Answers): Issue[] {
  switch (step) {
    case "form":
      return a.legalForm === "" ? [{ field: "legalForm", message: t.legalForm }] : [];
    case "name":
      return orderOf("name", nameIssues(a));
    case "place":
      return placeIssues(a);
    case "check":
      return [...stepIssues("form", a), ...stepIssues("name", a), ...stepIssues("place", a)];
  }
}

/** Ошибки по порядку полей шага (наименование, БИН, подписант — как на экране). */
function orderOf(step: Exclude<RegisterStep, "check">, issues: Issue[]): Issue[] {
  const order = STEP_FIELDS[step];
  return [...issues].sort((x, y) => order.indexOf(x.field) - order.indexOf(y.field));
}

/** Первое сообщение на каждое поле. */
export function errorsOf(issues: readonly Issue[]): Partial<Record<AnswerField, string>> {
  const out: Partial<Record<AnswerField, string>> = {};
  for (const issue of issues) out[issue.field] ??= issue.message;
  return out;
}

/** Номер первого шага с ошибкой; всё верно — шаг проверки. */
export function firstInvalidStep(a: Answers): number {
  const index = STEPS.findIndex((step) => step !== "check" && stepIssues(step, a).length > 0);
  return index < 0 ? STEPS.length - 1 : index;
}

/** Шаг, на котором стоит поле. */
export function stepOfField(field: string): RegisterStep | null {
  for (const step of ["form", "name", "place"] as const) if ((STEP_FIELDS[step] as readonly string[]).includes(field)) return step;
  return null;
}

/** Поле строкой ограниченной длины: ограничение защищает сервер, текст — тот, что у поля. */
const text = (max: number, message: string) => z.string({ error: message }).max(max, message);

/**
 * Вход действия «Отправить на проверку»: вся анкета строками. Проверка — та же, что у шагов в браузере (stepIssues), ошибки —
 * у полей. Выход — анкета с выбранной формой работы.
 */
export const answersSchema = z
  .object({
    legalForm: z.string().max(20),
    legalName: text(400, t.legalName),
    binIin: text(40, t.bin),
    ownerName: text(400, t.ownerName),
    directorName: text(400, t.directorName),
    directorIin: text(40, t.directorIin),
    city: text(200, t.city),
    district: text(400, t.district),
    streetAddress: text(800, t.street),
    yearsExperience: text(10, t.experience),
  })
  .superRefine((raw, ctx) => {
    const legalForm = isLegalForm(raw.legalForm) ? raw.legalForm : "";
    for (const issue of stepIssues("check", { ...raw, legalForm })) ctx.addIssue({ code: "custom", path: [issue.field], message: issue.message });
  })
  .transform((raw) => ({ ...raw, legalForm: raw.legalForm as LegalForm }));

export type SubmittedAnswers = z.infer<typeof answersSchema>;

/**
 * Проверенная анкета → вход схемы модуля (`executorRegistrationSchema`): лишние для формы работы поля не передаются,
 * номера без пробелов, опыт — числом. ИП и самозанятый номер не вводят: identity берёт ИИН из знакомства.
 */
export function moduleInput(a: SubmittedAnswers) {
  return {
    legalForm: a.legalForm,
    legalName: a.legalName.trim(),
    binIin: a.legalForm === "TOO" ? digitsOf(a.binIin) : "",
    city: a.city.trim(),
    district: a.district.trim(),
    streetAddress: a.streetAddress.trim(),
    yearsExperience: Number(a.yearsExperience.trim()),
    ownerName: a.legalForm === "IP" ? a.ownerName.trim() : undefined,
    directorName: a.legalForm === "TOO" ? a.directorName.trim() : undefined,
    directorIin: a.legalForm === "TOO" ? digitsOf(a.directorIin) : undefined,
  };
}
