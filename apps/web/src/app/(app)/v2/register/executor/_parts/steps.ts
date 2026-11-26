import { ru } from "@/i18n/ru";
import { to } from "../../../../_shell/paths";
import { digitsOf, STEPS, type AnswerField, type Answers, type LegalForm, type RegisterStep } from "./schema";

// Чистая логика экрана регистрации мастера (без React и браузера): адреса шагов, «Назад», начальные значения, что можно
// хранить в браузере, сводка последнего шага. Проверяет steps.test.ts.

const t = ru.app.masterRegister;

/** Адрес экрана: без шага — анкета (нет профиля) или статус проверки. */
export const REGISTER_PATH = to("/register/executor");

/** Адрес шага анкеты: `/v2/register/executor?step=name`. */
export const stepHref = (step: RegisterStep): string => `${REGISTER_PATH}?${new URLSearchParams({ step })}`;

/** Шаг из адреса; неизвестный и пустой — `null` (анкета откроется с первого шага, статус — без анкеты). */
export function parseStep(raw: string | undefined): RegisterStep | null {
  return (STEPS as readonly string[]).includes(raw ?? "") ? (raw as RegisterStep) : null;
}

/** Вход гостя с выбранной ролью мастера и возвратом сюда. */
export const guestLoginHref = (): string => `${to("/login")}?${new URLSearchParams({ role: "executor", next: REGISTER_PATH })}`;

/** Откуда пришёл человек: новая анкета — с главной, повторная после отказа — с экрана статуса. */
export type Origin = "home" | "status";

/**
 * «Назад»: с первого шага — на главную (после отказа — к статусу), дальше — на прошлый шаг с его заголовком. Если анкета —
 * дом человека (`isHome`: мастер без профиля, идущий к профилю мастера), на первом шаге «Назад» нет: главная привела бы
 * обратно сюда.
 */
export function backOf(step: RegisterStep, origin: Origin, isHome = false): { href: string; label: string } | undefined {
  const index = STEPS.indexOf(step);
  if (index <= 0 && isHome) return undefined;
  if (index <= 0) return origin === "status" ? { href: REGISTER_PATH, label: t.backStatus } : { href: to("/"), label: t.backHome };
  const previous = STEPS[index - 1];
  return { href: stepHref(previous), label: t.steps[previous] };
}

/** Пустая анкета: город по умолчанию; после отказа — прежние форма работы и наименование. */
export function initialAnswers(previous: { legalForm: LegalForm; legalName: string } | null = null): Answers {
  return {
    legalForm: previous?.legalForm ?? "",
    legalName: previous?.legalName ?? "",
    binIin: "",
    ownerName: "",
    directorName: "",
    directorIin: "",
    city: t.place.defaultCity,
    yearsExperience: "",
  };
}

/**
 * После выбора формы работы: ФИО из знакомства подставляется туда, где подписант — сам человек (наименование самозанятого,
 * владелец ИП), если поле ещё пустое; введённое не стирается.
 */
export function prefillSigner(a: Answers, fullName: string | null): Answers {
  if (!fullName) return a;
  if (a.legalForm === "SELF_EMPLOYED" && a.legalName.trim() === "") return { ...a, legalName: fullName };
  if (a.legalForm === "IP" && a.ownerName.trim() === "") return { ...a, ownerName: fullName };
  return a;
}

/**
 * Поля, которые не хранятся в браузере даже на время анкеты: БИН и ИИН директора живут только в памяти страницы. После
 * перезагрузки их вводят заново — зато полного номера нет ни в адресе, ни в хранилище вкладки.
 */
export const SECRET_FIELDS: readonly AnswerField[] = ["binIin", "directorIin"];

/** То, что можно положить в хранилище вкладки: анкета без номеров. */
export function persistable(a: Answers): Partial<Answers> {
  return Object.fromEntries(Object.entries(a).filter(([key]) => !SECRET_FIELDS.includes(key as AnswerField))) as Partial<Answers>;
}

/** Сохранённое поверх начального: только известные поля-строки, кроме номеров; форма работы — только допустимая. */
export function restoreAnswers(initial: Answers, saved: unknown): Answers {
  if (typeof saved !== "object" || saved === null || Array.isArray(saved)) return initial;
  const out: Answers = { ...initial };
  for (const [key, value] of Object.entries(saved)) {
    if (!(key in initial) || SECRET_FIELDS.includes(key as AnswerField) || typeof value !== "string") continue;
    if (key === "legalForm" && !["", "SELF_EMPLOYED", "IP", "TOO"].includes(value)) continue;
    (out as Record<string, string>)[key] = value;
  }
  return out;
}

/** Последние 4 цифры номера (пробелы не считаются). */
export const last4 = (value: string): string => digitsOf(value).slice(-4);

export type SummaryRow = { label: string; value: string; step: RegisterStep };

/**
 * Сводка последнего шага: каждая строка ведёт на шаг, где её поменять. Номера — только последние 4 цифры: ИИН из
 * знакомства у самозанятого и ИП, БИН и ИИН директора у ТОО.
 */
export function summaryRows(a: Answers, ownIinLast4: string | null): SummaryRow[] {
  const c = t.check;
  if (a.legalForm === "") return [];
  const rows: (SummaryRow | null)[] = [
    { label: c.form, value: t.form.legalForms[a.legalForm], step: "form" },
    { label: a.legalForm === "SELF_EMPLOYED" ? c.fullName : c.legalName, value: a.legalName.trim(), step: "name" },
    a.legalForm === "TOO"
      ? { label: c.bin, value: c.masked(last4(a.binIin)), step: "name" }
      : ownIinLast4
        ? { label: c.ownIin, value: c.masked(ownIinLast4), step: "name" }
        : null,
    a.legalForm === "IP" ? { label: c.signer, value: a.ownerName.trim(), step: "name" } : null,
    a.legalForm === "TOO" ? { label: c.signer, value: a.directorName.trim(), step: "name" } : null,
    a.legalForm === "TOO" ? { label: c.directorIin, value: c.masked(last4(a.directorIin)), step: "name" } : null,
    { label: c.city, value: a.city.trim(), step: "place" },
    { label: c.experience, value: c.experienceValue(Number(a.yearsExperience.trim())), step: "place" },
  ];
  return rows.filter((row): row is SummaryRow => row !== null);
}
