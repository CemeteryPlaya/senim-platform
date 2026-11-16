import { describe, expect, it } from "vitest";
import { testBin, testIin } from "@/seed/kz-id";
import { ru } from "@/i18n/ru";
import { AppError } from "@/platform/errors";
import { isAlreadyRegistered, v2Failure } from "./errors";
import type { Answers } from "./schema";
import { backOf, guestLoginHref, initialAnswers, parseStep, persistable, prefillSigner, restoreAnswers, stepHref, summaryRows } from "./steps";

const t = ru.app.masterRegister;
const BIN = testBin("2101", 16);
const DIRECTOR_IIN = testIin("800215", 3, 41);
const too: Answers = {
  ...initialAnswers(),
  legalForm: "TOO",
  legalName: "ТОО «Ағаш»",
  binIin: BIN,
  directorName: "Тулегенов Бауыржан",
  directorIin: DIRECTOR_IIN,
  yearsExperience: "7",
};

describe("адреса и «Назад»", () => {
  it("шаг — в адресе, неизвестный — null", () => {
    expect(stepHref("name")).toBe("/v2/register/executor?step=name");
    expect(parseStep("place")).toBe("place");
    expect(parseStep("pay")).toBeNull();
    expect(parseStep(undefined)).toBeNull();
  });

  it("с первого шага — на главную (после отказа — к статусу), дальше — на прошлый шаг с его заголовком", () => {
    expect(backOf("form", "home")).toEqual({ href: "/v2", label: t.backHome });
    expect(backOf("form", "status")).toEqual({ href: "/v2/register/executor", label: t.backStatus });
    expect(backOf("name", "home")).toEqual({ href: "/v2/register/executor?step=form", label: t.steps.form });
    expect(backOf("check", "status")).toEqual({ href: "/v2/register/executor?step=place", label: t.steps.place });
  });

  it("гость — на вход мастером с возвратом сюда", () => {
    expect(guestLoginHref()).toBe("/v2/login?role=executor&next=%2Fv2%2Fregister%2Fexecutor");
  });
});

describe("начальные значения и черновик вкладки", () => {
  it("пустая анкета — город по умолчанию; после отказа — прежние форма и наименование", () => {
    expect(initialAnswers()).toMatchObject({ legalForm: "", legalName: "", city: t.place.defaultCity, yearsExperience: "" });
    expect(initialAnswers({ legalForm: "IP", legalName: "ИП «Дала»" })).toMatchObject({ legalForm: "IP", legalName: "ИП «Дала»" });
  });

  it("ФИО из знакомства — в наименование самозанятого и владельца ИП, только в пустое поле", () => {
    const empty = initialAnswers();
    expect(prefillSigner({ ...empty, legalForm: "SELF_EMPLOYED" }, "Сапаров Ерлан").legalName).toBe("Сапаров Ерлан");
    expect(prefillSigner({ ...empty, legalForm: "IP" }, "Сапаров Ерлан")).toMatchObject({ legalName: "", ownerName: "Сапаров Ерлан" });
    expect(prefillSigner({ ...empty, legalForm: "IP", ownerName: "Другой Человек" }, "Сапаров Ерлан").ownerName).toBe("Другой Человек");
    expect(prefillSigner({ ...empty, legalForm: "TOO" }, "Сапаров Ерлан")).toMatchObject({ legalName: "", directorName: "" });
    expect(prefillSigner({ ...empty, legalForm: "SELF_EMPLOYED" }, null).legalName).toBe("");
  });

  it("БИН и ИИН директора в хранилище не попадают и из него не берутся", () => {
    const stored = JSON.stringify(persistable(too));
    expect(stored).not.toContain(BIN);
    expect(stored).not.toContain(DIRECTOR_IIN);
    expect(stored).toContain("ТОО «Ағаш»");
    const back = restoreAnswers(initialAnswers(), { ...JSON.parse(stored), binIin: BIN, directorIin: DIRECTOR_IIN });
    expect(back).toMatchObject({ legalForm: "TOO", legalName: "ТОО «Ағаш»", binIin: "", directorIin: "" });
  });

  it("испорченное и чужое в хранилище отбрасывается", () => {
    const initial = initialAnswers();
    expect(restoreAnswers(initial, null)).toEqual(initial);
    expect(restoreAnswers(initial, ["x"])).toEqual(initial);
    expect(restoreAnswers(initial, { legalForm: "OOO", city: 5, extra: "x", legalName: "ИП «Дала»" })).toEqual({ ...initial, legalName: "ИП «Дала»" });
  });
});

describe("сводка последнего шага", () => {
  it("ТОО: БИН и ИИН директора — только последние 4 цифры, каждая строка ведёт на свой шаг", () => {
    const rows = summaryRows({ ...too, binIin: `${BIN.slice(0, 6)} ${BIN.slice(6)}` }, "9999");
    const all = JSON.stringify(rows);
    expect(all).not.toContain(BIN.slice(0, 8));
    expect(all).not.toContain(DIRECTOR_IIN.slice(0, 8));
    expect(rows).toContainEqual({ label: t.check.bin, value: `•••• ${BIN.slice(-4)}`, step: "name" });
    expect(rows).toContainEqual({ label: t.check.directorIin, value: `•••• ${DIRECTOR_IIN.slice(-4)}`, step: "name" });
    // ИИН из знакомства у ТОО не показывается: номер организации — БИН.
    expect(all).not.toContain("9999");
    expect(rows.map((r) => r.step)).toEqual(["form", "name", "name", "name", "name", "place", "place"]);
  });

  it("самозанятый: ФИО и ИИН из знакомства (4 цифры); район и адрес — только указанные; опыт словами", () => {
    const rows = summaryRows({ ...initialAnswers(), legalForm: "SELF_EMPLOYED", legalName: "Сапаров Ерлан", district: "Есиль", yearsExperience: "1" }, "1234");
    expect(rows).toEqual([
      { label: t.check.form, value: t.form.legalForms.SELF_EMPLOYED, step: "form" },
      { label: t.check.fullName, value: "Сапаров Ерлан", step: "name" },
      { label: t.check.ownIin, value: "•••• 1234", step: "name" },
      { label: t.check.city, value: t.place.defaultCity, step: "place" },
      { label: t.check.district, value: "Есиль", step: "place" },
      { label: t.check.experience, value: "1 год", step: "place" },
    ]);
  });
});

describe("отказы регистрации → тексты и поля v2", () => {
  const reg = ru.identity.registration.errors;
  const person = ru.identity.clientIdentity;
  const mapped = (e: AppError, form: "SELF_EMPLOYED" | "IP" | "TOO" = "TOO") => {
    const out = v2Failure(e, form) as AppError;
    return { code: out.code, message: out.message, fields: (out.details?.["fieldErrors"] ?? null) as Record<string, string[]> | null };
  };

  it("«уже подали» — не ошибка, а тот же итог", () => {
    expect(isAlreadyRegistered(new AppError("CONFLICT", reg.alreadyRegistered))).toBe(true);
    expect(isAlreadyRegistered(new AppError("CONFLICT", reg.partyExists))).toBe(false);
    expect(isAlreadyRegistered(new Error(reg.alreadyRegistered))).toBe(false);
  });

  it("номер занят — у поля БИН текстом v2", () => {
    expect(mapped(new AppError("CONFLICT", reg.binIinTaken))).toEqual({ code: "CONFLICT", message: t.errors.binIinTaken, fields: { binIin: [t.errors.binIinTaken] } });
  });

  it("неверный номер: у ТОО — БИН, у ИП и самозанятого — ИИН из знакомства", () => {
    const e = new AppError("VALIDATION", reg.binIinInvalid, { fieldErrors: { binIin: [reg.binIinInvalid] } });
    expect(mapped(e).fields).toEqual({ binIin: [t.errors.bin] });
    expect(mapped(e, "IP").fields).toEqual({ binIin: [t.errors.ownIinInvalid] });
  });

  it("ФИО подписанта — у поля подписанта своей формы; ИИН подписанта — у ИИН директора", () => {
    const name = new AppError("VALIDATION", person.fullNameInvalid, { fieldErrors: { fullName: [person.fullNameInvalid] } });
    expect(mapped(name, "SELF_EMPLOYED").fields).toEqual({ legalName: [t.errors.selfEmployedName] });
    expect(mapped(name, "IP").fields).toEqual({ ownerName: [t.errors.ownerName] });
    expect(mapped(name, "TOO").fields).toEqual({ directorName: [t.errors.directorName] });
    expect(mapped(new AppError("VALIDATION", person.iinInvalid)).fields).toEqual({ directorIin: [t.errors.directorIin] });
  });

  it("общие отказы — текстами v2 без поля; неизвестное — как есть", () => {
    expect(mapped(new AppError("RATE_LIMITED", reg.tooMany))).toEqual({ code: "RATE_LIMITED", message: t.errors.tooMany, fields: null });
    expect(mapped(new AppError("CONFLICT", reg.partyExists)).message).toBe(t.errors.partyExists);
    expect(mapped(new AppError("VALIDATION", reg.signerRequired)).message).toBe(t.errors.signerRequired);
    const other = new AppError("UNAVAILABLE", ru.common.errors.generic);
    expect(v2Failure(other, "IP")).toBe(other);
    const crash = new Error("x");
    expect(v2Failure(crash, "IP")).toBe(crash);
  });
});
