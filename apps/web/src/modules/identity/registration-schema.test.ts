import { describe, expect, it } from "vitest";
import { z } from "zod";
import { testBin, testIin } from "@/demo/kz-id";
import { executorRegistrationSchema } from "./registration-schema";

const IIN = testIin("910803", 3, 21);
const BIN = testBin("2101", 16);
const DIRECTOR_IIN = testIin("800215", 3, 41);
const director = { directorName: "Тулегенов Бауыржан", directorIin: DIRECTOR_IIN };
const valid = { legalForm: "IP", legalName: "  ИП «Дала Мебель» ", ownerName: "Жумабаев Ерлан", binIin: IIN, city: "Астана", yearsExperience: "5" };

function fieldErrors(input: unknown) {
  const parsed = executorRegistrationSchema.safeParse(input);
  return parsed.success ? {} : z.flattenError(parsed.error).fieldErrors;
}

describe("executorRegistrationSchema", () => {
  it("чистит ввод: пробелы в имени, опыт числом; у ИП номера нет (ИИН личности берёт identity)", () => {
    expect(executorRegistrationSchema.parse(valid)).toEqual({
      legalForm: "IP",
      legalName: "ИП «Дала Мебель»",
      binIin: "",
      city: "Астана",
      yearsExperience: 5,
      signer: { fullName: "Жумабаев Ерлан", iin: null },
    });
    expect(executorRegistrationSchema.parse({ ...valid, ...director, legalForm: "TOO", binIin: BIN.replace(/(\d{4})/g, "$1 ") }).binIin).toBe(BIN);
  });

  it("адрес мастерской (№6): район и улица необязательны, пробелы обрезаются, длина ограничена", () => {
    expect(executorRegistrationSchema.parse({ ...valid, district: " Есильский район ", streetAddress: " ул. Сыганак, 10 " })).toMatchObject({
      district: "Есильский район",
      streetAddress: "ул. Сыганак, 10",
    });
    expect(fieldErrors({ ...valid, district: "р".repeat(101) })).toHaveProperty("district");
    expect(fieldErrors({ ...valid, streetAddress: "у".repeat(201) })).toHaveProperty("streetAddress");
  });

  it("ИП и самозанятый номер не вводят (Ruling U): присланный — даже чужой или неверный — не читается, ошибки нет", () => {
    for (const binIin of [undefined, "", IIN, BIN, "123"]) {
      expect(fieldErrors({ ...valid, binIin })).toEqual({});
      expect(executorRegistrationSchema.parse({ ...valid, binIin }).binIin).toBe("");
    }
    expect(fieldErrors({ ...valid, legalForm: "SELF_EMPLOYED", legalName: "Жумабаев Ерлан", binIin: undefined })).toEqual({});
    // Подписант по-прежнему проверяется.
    expect(fieldErrors({ ...valid, ownerName: "" })).toHaveProperty("ownerName");
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

    expect(executorRegistrationSchema.parse({ ...tooBase, directorName: "  Тулегенов   Бауыржан ", directorIin: DIRECTOR_IIN.replace(/(\d{4})/g, "$1 ") }).signer).toEqual({
      fullName: "Тулегенов Бауыржан",
      iin: DIRECTOR_IIN,
    });
  });

  it("ИП — подписывает владелец: его ФИО обязательно (наименование ИП бывает фирменным), ИИН — ИИН профиля", () => {
    expect(fieldErrors({ ...valid, ownerName: "" })).toHaveProperty("ownerName");
    expect(fieldErrors({ ...valid, ownerName: "Жумабаев" })).toHaveProperty("ownerName");
    expect(executorRegistrationSchema.parse({ ...valid, ...director, ownerName: " Жумабаев  Ерлан " }).signer).toEqual({ fullName: "Жумабаев Ерлан", iin: null });
  });

  it("самозанятый — подписывает сам: наименование и есть его ФИО, директор и владелец игнорируются", () => {
    const self = { ...valid, legalForm: "SELF_EMPLOYED", legalName: " Жумабаев  Ерлан Серикович ", ownerName: "", ...director };
    expect(executorRegistrationSchema.parse(self).signer).toEqual({ fullName: "Жумабаев Ерлан Серикович", iin: null });
    expect(fieldErrors({ ...self, legalName: "Ерлан" })).toHaveProperty("legalName");
  });

  it("ТОО: пустой БИН — просьба указать номер, а не «проверьте контрольную цифру»", () => {
    expect(fieldErrors({ ...valid, ...director, legalForm: "TOO", binIin: "  " }).binIin).toEqual(["Укажите БИН"]);
    expect(fieldErrors({ ...valid, ...director, legalForm: "TOO", binIin: undefined }).binIin).toEqual(["Укажите БИН"]);
  });

  it("ТОО: неверная контрольная цифра — ошибка поля БИН", () => {
    const broken = BIN.slice(0, 11) + String((Number(BIN[11]) + 1) % 10);
    expect(fieldErrors({ ...valid, ...director, legalForm: "TOO", binIin: broken }).binIin?.[0]).toMatch(/БИН/);
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
