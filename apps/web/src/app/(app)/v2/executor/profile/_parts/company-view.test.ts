import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { companyNow, formatFee, initialValues, masterBack, publicHref, sectionLinks, type CompanyProfile } from "./company-view";
import { companySchema, toNumber, type CompanyInput } from "./company-schema";

const t = ru.app.masterCompany.company;

const profile: CompanyProfile = {
  publicNumber: 17,
  label: "Исполнитель №17",
  status: "APPROVED",
  rejectReason: null,
  legalName: "ИП «Дала»",
  about: "Делаю кухни",
  yearsExperience: 7,
  specializationIds: ["a", "b"],
  measurementTerms: "FEE_IF_NO_DEAL",
  measurementFee: 10_000,
  city: "Астана",
};

describe("карточка «Сейчас / Дальше» компании", () => {
  it("на проверке — что можно сделать пока; отказ — причина и ссылка на анкету; одобрен — как видят покупатели", () => {
    expect(companyNow({ status: "PENDING", rejectReason: null })).toMatchObject({ title: t.now.PENDING.title });
    const rejected = companyNow({ status: "REJECTED", rejectReason: "Не читается документ" });
    expect(rejected.body).toBe(t.now.REJECTED.reason("Не читается документ"));
    expect(rejected.fixHref).toBe("/v2/register/executor?step=form");
    expect(companyNow({ status: "REJECTED", rejectReason: null }).body).toBe(t.now.REJECTED.noReason);
    expect(companyNow({ status: "APPROVED", rejectReason: null }).title).toBe(t.now.APPROVED.title);
    expect(companyNow({ status: "APPROVED", rejectReason: null }).fixHref).toBeUndefined();
    // Проверен — дальше ничего не ждёт: без «Дальше» (и без совета, как работает «Сохранить»).
    expect(companyNow({ status: "APPROVED", rejectReason: null })).toEqual({ title: t.now.APPROVED.title, body: t.now.APPROVED.body });
  });
});

describe("разделы и публичная страница", () => {
  it("разделы — документы, счёт и портфолио — только у неодобренного (одобренному они на «Профиле»); публичная страница — только у одобренного", () => {
    const pending = sectionLinks("PENDING").map((r) => r.href);
    expect(pending).toEqual(["/v2/executor/profile/kyc", "/v2/executor/profile/payout", "/v2/executor/portfolio"]);
    expect(sectionLinks("REJECTED").map((r) => r.href)).toEqual(pending);
    expect(sectionLinks("APPROVED")).toEqual([]);
    expect(publicHref({ status: "APPROVED", publicNumber: 17 })).toBe("/v2/executors/17");
    expect(publicHref({ status: "PENDING", publicNumber: 17 })).toBeNull();
  });

  it("«Назад» с документов, счёта и портфолио: одобренному — «Профиль», иначе — «Компания»", () => {
    expect(masterBack(true)).toEqual({ href: "/v2/profile", label: ru.app.masterCompany.shared.backProfile });
    expect(masterBack(false)).toEqual({ href: "/v2/executor/profile", label: ru.app.masterCompany.shared.backCompany });
  });

  it("плата — с разделителем разрядов; не число остаётся как ввели", () => {
    expect(formatFee("10000")).toBe("10 000");
    expect(formatFee("10 000")).toBe("10 000");
    expect(formatFee("1500000")).toBe("1 500 000");
    expect(formatFee("")).toBe("");
    expect(formatFee("abc")).toBe("abc");
  });

  it("начальные значения формы — строки; плата пустая, когда её нет", () => {
    expect(initialValues(profile)).toMatchObject({ years: "7", fee: "10 000", terms: "FEE_IF_NO_DEAL", specializationIds: ["a", "b"] });
    expect(initialValues({ ...profile, measurementFee: null }).fee).toBe("");
  });
});

const base: CompanyInput = {
  about: "  Делаю кухни  ",
  yearsExperience: 7,
  specializationIds: ["a"],
  measurementTerms: "FREE",
  measurementFee: null,
  city: "Астана",
};
const issues = (input: unknown) => {
  const r = companySchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
};

describe("проверка формы компании", () => {
  it("верные значения проходят, «О себе» обрезается по краям", () => {
    const r = companySchema.safeParse(base);
    expect(r.success && r.data.about).toBe("Делаю кухни");
  });

  it("опыт — целое от 0 до 60; «не число» — тот же текст у поля", () => {
    const e = t.form.errors.experience;
    for (const years of [-1, 61, 2.5, Number.NaN]) expect(issues({ ...base, yearsExperience: years })).toEqual([`yearsExperience: ${e}`]);
  });

  it("плата за выезд — только при платном замере, от 1 000 до 200 000", () => {
    const e = t.form.errors.fee(1000, 200_000);
    expect(issues({ ...base, measurementTerms: "FEE_IF_NO_DEAL", measurementFee: null })).toEqual([`measurementFee: ${e}`]);
    expect(issues({ ...base, measurementTerms: "FEE_IF_NO_DEAL", measurementFee: 999 })).toEqual([`measurementFee: ${e}`]);
    expect(issues({ ...base, measurementTerms: "FEE_IF_NO_DEAL", measurementFee: 200_001 })).toEqual([`measurementFee: ${e}`]);
    expect(issues({ ...base, measurementTerms: "FEE_IF_NO_DEAL", measurementFee: 10_000 })).toEqual([]);
    expect(issues({ ...base, measurementTerms: "INCLUDED", measurementFee: null })).toEqual([]);
  });

  it("город обязателен; района и улицы в форме нет (ADR-016) — как и любые лишние поля, они отвергаются", () => {
    expect(issues({ ...base, city: " " })).toEqual([`city: ${t.form.errors.city}`]);
    expect(issues({ ...base, district: "Есильский район" })).not.toEqual([]);
    expect(issues({ ...base, streetAddress: "ул. Сыганак, 10" })).not.toEqual([]);
    expect(issues({ ...base, status: "APPROVED" })).not.toEqual([]);
  });

  it("число из поля: пробелы и неразрывные пробелы допустимы, пусто — null", () => {
    expect(toNumber("10 000")).toBe(10_000);
    expect(toNumber("10 000")).toBe(10_000);
    expect(toNumber("  ")).toBeNull();
    expect(Number.isNaN(toNumber("abc"))).toBe(true);
  });
});
