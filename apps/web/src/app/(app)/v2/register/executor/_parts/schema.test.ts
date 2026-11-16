import { describe, expect, it } from "vitest";
import { testBin, testIin } from "@/seed/kz-id";
import { ru } from "@/i18n/ru";
import { executorRegistrationSchema } from "@/modules/identity";
import { answersSchema, errorsOf, firstInvalidStep, moduleInput, stepIssues, stepOfField, type Answers, type SubmittedAnswers } from "./schema";
import { initialAnswers } from "./steps";

const t = ru.app.masterRegister.errors;
const BIN = testBin("2101", 16);
const DIRECTOR_IIN = testIin("800215", 3, 41);

const base: Answers = { ...initialAnswers(), city: "Астана", yearsExperience: "7" };
const selfEmployed: Answers = { ...base, legalForm: "SELF_EMPLOYED", legalName: "Жумабаев Ерлан" };
const ip: Answers = { ...base, legalForm: "IP", legalName: "ИП «Дала»", ownerName: "Жумабаев Ерлан" };
const too: Answers = {
  ...base,
  legalForm: "TOO",
  legalName: "ТОО «Ағаш»",
  binIin: `${BIN.slice(0, 6)} ${BIN.slice(6)}`,
  directorName: "Тулегенов Бауыржан",
  directorIin: DIRECTOR_IIN,
};

const errors = (a: Answers) => errorsOf(stepIssues("check", a));

describe("анкета мастера: проверка по формам работы", () => {
  it.each([
    ["самозанятый", selfEmployed],
    ["ИП", ip],
    ["ТОО (БИН с пробелом)", too],
  ])("%s: верная анкета — без ошибок, открыт шаг проверки", (_name, a) => {
    expect(errors(a)).toEqual({});
    expect(firstInvalidStep(a)).toBe(3);
  });

  it("форма работы не выбрана — ошибка у группы, первый шаг", () => {
    expect(errors(base)).toMatchObject({ legalForm: t.legalForm });
    expect(firstInvalidStep(base)).toBe(0);
  });

  it("самозанятый: наименование — его ФИО полностью", () => {
    expect(errors({ ...selfEmployed, legalName: "Ерлан" })).toEqual({ legalName: t.selfEmployedName });
    expect(errors({ ...selfEmployed, legalName: " " })).toEqual({ legalName: t.legalName });
  });

  it("ИП: нужен владелец; БИН и директор не спрашиваются", () => {
    expect(errors({ ...ip, ownerName: "" })).toEqual({ ownerName: t.ownerName });
    expect(errors({ ...ip, binIin: "", directorIin: "" })).toEqual({});
  });

  it("ТОО: БИН, директор и его ИИН — пустые и неверные по-разному", () => {
    expect(errors({ ...too, binIin: "", directorName: "", directorIin: "" })).toEqual({
      binIin: t.binRequired,
      directorName: t.directorName,
      directorIin: t.directorIinRequired,
    });
    expect(errors({ ...too, binIin: "123456789012", directorIin: "123456789012" })).toEqual({ binIin: t.bin, directorIin: t.directorIin });
    // ИИН вместо БИН (и наоборот) не проходит.
    expect(errors({ ...too, binIin: DIRECTOR_IIN, directorIin: BIN })).toEqual({ binIin: t.bin, directorIin: t.directorIin });
  });

  it("шаг «где работаете»: город, длины района и адреса, опыт целым от 0 до 60", () => {
    expect(errors({ ...ip, city: " ", district: "р".repeat(101), streetAddress: "у".repeat(201), yearsExperience: "61" })).toEqual({
      city: t.city,
      district: t.district,
      streetAddress: t.street,
      yearsExperience: t.experience,
    });
    for (const bad of ["", "-1", "2,5", "семь"]) expect(errors({ ...ip, yearsExperience: bad })).toEqual({ yearsExperience: t.experience });
    expect(errors({ ...ip, yearsExperience: "0" })).toEqual({});
  });

  it("ошибки шага — только его полей, в порядке на экране", () => {
    const a = { ...too, legalName: "", binIin: "", city: "" };
    expect(stepIssues("name", a).map((i) => i.field)).toEqual(["legalName", "binIin"]);
    expect(stepIssues("place", a).map((i) => i.field)).toEqual(["city"]);
    expect(firstInvalidStep(a)).toBe(1);
  });

  it("поле → шаг", () => {
    expect(stepOfField("legalForm")).toBe("form");
    expect(stepOfField("directorIin")).toBe("name");
    expect(stepOfField("yearsExperience")).toBe("place");
    expect(stepOfField("code")).toBeNull();
  });
});

describe("схема действия и схема модуля", () => {
  const parse = (a: Answers) => answersSchema.safeParse(a);

  it.each([
    ["самозанятый", selfEmployed],
    ["ИП", ip],
    ["ТОО", too],
  ])("%s: принятое схемой v2 принимает и модуль; номера без пробелов, лишние поля не уходят", (_name, a) => {
    const v2 = parse({ ...a, binIin: a.legalForm === "TOO" ? a.binIin : "лишнее" });
    expect(v2.success).toBe(true);
    if (!v2.success) return;
    const inModule = executorRegistrationSchema.safeParse(moduleInput(v2.data));
    expect(inModule.success).toBe(true);
    if (!inModule.success) return;
    expect(inModule.data.binIin).toBe(a.legalForm === "TOO" ? BIN : "");
    expect(inModule.data.yearsExperience).toBe(7);
    expect(inModule.data.signer.iin).toBe(a.legalForm === "TOO" ? DIRECTOR_IIN : null);
  });

  it("ошибки схемы действия — у полей, текстами v2", () => {
    const res = parse({ ...too, binIin: "", legalForm: "OOO" as Answers["legalForm"] });
    expect(res.success).toBe(false);
    const fields = Object.fromEntries((res.error?.issues ?? []).map((i) => [i.path[0], i.message]));
    expect(fields).toMatchObject({ legalForm: t.legalForm });
  });

  it("всё, что отвергает модуль, отвергает и схема v2 (образцы)", () => {
    const samples: Answers[] = [
      { ...selfEmployed, legalName: "Ерлан" },
      { ...ip, ownerName: "Ерлан" },
      { ...too, binIin: "1" },
      { ...too, directorIin: "" },
      { ...too, directorName: "Ерлан" },
      { ...ip, city: "А" },
      { ...ip, yearsExperience: "61" },
    ];
    for (const a of samples) {
      expect(executorRegistrationSchema.safeParse(moduleInput(a as SubmittedAnswers)).success).toBe(false);
      expect(parse(a).success).toBe(false);
    }
  });
});
