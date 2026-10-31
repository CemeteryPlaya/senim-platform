import { describe, expect, it } from "vitest";
import { z } from "zod";
import { testBin, testIin } from "@/demo/kz-id";
import { executorRegistrationSchema } from "./registration-schema";

const IIN = testIin("910803", 3, 21);
const BIN = testBin("2101", 16);
const DIRECTOR_IIN = testIin("800215", 3, 41);
const director = { directorName: "Тулегенов Бауыржан", directorIin: DIRECTOR_IIN };
const valid = { legalForm: "IP", legalName: "  ИП «Дала Мебель» ", binIin: IIN, city: "Астана", yearsExperience: "5" };

function fieldErrors(input: unknown) {
  const parsed = executorRegistrationSchema.safeParse(input);
  return parsed.success ? {} : z.flattenError(parsed.error).fieldErrors;
}

describe("executorRegistrationSchema", () => {
  it("чистит ввод: пробелы в имени и в номере, опыт числом", () => {
    expect(executorRegistrationSchema.parse({ ...valid, binIin: IIN.replace(/(\d{4})/g, "$1 ") })).toEqual({
      legalForm: "IP",
      legalName: "ИП «Дала Мебель»",
      binIin: IIN,
      city: "Астана",
      yearsExperience: 5,
      director: null,
    });
  });

  it("ИП и самозанятый — по ИИН, БИН для них не подходит", () => {
    expect(fieldErrors({ ...valid, binIin: BIN })).toHaveProperty("binIin");
    expect(fieldErrors({ ...valid, legalForm: "SELF_EMPLOYED", binIin: BIN })).toHaveProperty("binIin");
  });

  it("ТОО — по БИН, ИИН для него не подходит", () => {
    expect(fieldErrors({ ...valid, ...director, legalForm: "TOO", binIin: BIN })).toEqual({});
    expect(fieldErrors({ ...valid, ...director, legalForm: "TOO", binIin: IIN })).toHaveProperty("binIin");
  });

  it("ТОО — ФИО и ИИН директора обязательны: он подписывает договор своей ЭЦП", () => {
    const tooBase = { ...valid, legalForm: "TOO", binIin: BIN };
    expect(fieldErrors(tooBase)).toMatchObject({ directorName: expect.any(Array), directorIin: expect.any(Array) });
    expect(fieldErrors({ ...tooBase, ...director, directorName: "Тулегенов" })).toHaveProperty("directorName");
    const broken = DIRECTOR_IIN.slice(0, 11) + String((Number(DIRECTOR_IIN[11]) + 1) % 10);
    expect(fieldErrors({ ...tooBase, ...director, directorIin: broken })).toHaveProperty("directorIin");
    expect(fieldErrors({ ...tooBase, ...director, directorIin: BIN })).toHaveProperty("directorIin");

    expect(executorRegistrationSchema.parse({ ...tooBase, directorName: "  Тулегенов   Бауыржан ", directorIin: DIRECTOR_IIN.replace(/(\d{4})/g, "$1 ") }).director).toEqual({
      fullName: "Тулегенов Бауыржан",
      iin: DIRECTOR_IIN,
    });
  });

  it("ИП и самозанятый — директор не нужен и игнорируется", () => {
    expect(executorRegistrationSchema.parse({ ...valid, ...director }).director).toBeNull();
    expect(executorRegistrationSchema.parse({ ...valid, directorName: "", directorIin: "" }).director).toBeNull();
  });

  it("неверная контрольная цифра — ошибка поля ИИН/БИН", () => {
    const broken = IIN.slice(0, 11) + String((Number(IIN[11]) + 1) % 10);
    expect(fieldErrors({ ...valid, binIin: broken }).binIin?.[0]).toMatch(/ИИН/);
  });

  it.each([
    [{ legalName: "А" }, "legalName"],
    [{ city: " " }, "city"],
    [{ yearsExperience: "-1" }, "yearsExperience"],
    [{ yearsExperience: "61" }, "yearsExperience"],
    [{ yearsExperience: "пять" }, "yearsExperience"],
    [{ legalForm: "LLC" }, "legalForm"],
  ])("отклоняет %o", (patch, field) => {
    expect(fieldErrors({ ...valid, ...patch })).toHaveProperty(field);
  });
});
