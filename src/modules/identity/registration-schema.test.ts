import { describe, expect, it } from "vitest";
import { z } from "zod";
import { testBin, testIin } from "@/demo/kz-id";
import { executorRegistrationSchema } from "./registration-schema";

const IIN = testIin("910803", 3, 21);
const BIN = testBin("2101", 16);
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
    });
  });

  it("ИП и самозанятый — по ИИН, БИН для них не подходит", () => {
    expect(fieldErrors({ ...valid, binIin: BIN })).toHaveProperty("binIin");
    expect(fieldErrors({ ...valid, legalForm: "SELF_EMPLOYED", binIin: BIN })).toHaveProperty("binIin");
  });

  it("ТОО — по БИН, ИИН для него не подходит", () => {
    expect(fieldErrors({ ...valid, legalForm: "TOO", binIin: BIN })).toEqual({});
    expect(fieldErrors({ ...valid, legalForm: "TOO", binIin: IIN })).toHaveProperty("binIin");
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
