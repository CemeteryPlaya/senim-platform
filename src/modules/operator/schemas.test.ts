import { describe, expect, it } from "vitest";
import { z } from "zod";
import { addExecutorSchema, auditFilterSchema, resolveDisputeSchema } from "./schemas";

describe("форма ручного добавления", () => {
  it("разбирает форму и чистит пробелы в ИИН/БИН", () => {
    const parsed = addExecutorSchema.parse({
      phone: "8 700 111 22 33",
      legalForm: "IP",
      legalName: "  ИП Тест ",
      ownerName: " Тестов  Тест ",
      binIin: "9001 0130 0017",
      segment: "ECONOMY",
    });
    expect(parsed).toEqual({
      phone: "+77001112233",
      legalForm: "IP",
      legalName: "ИП Тест",
      binIin: "900101300017",
      segment: "ECONOMY",
      signer: { fullName: "Тестов Тест", iin: null },
    });
  });

  it("ИП проверяется как ИИН, ТОО — как БИН", () => {
    const base = { phone: "+77001112233", legalName: "Тест", ownerName: "Тестов Тест", segment: "ECONOMY", directorName: "Тулегенов Бауыржан", directorIin: "900101300017" };
    expect(addExecutorSchema.safeParse({ ...base, legalForm: "IP", binIin: "210140000016" }).success).toBe(false);
    expect(addExecutorSchema.safeParse({ ...base, legalForm: "TOO", binIin: "210140000016" }).success).toBe(true);
    expect(addExecutorSchema.safeParse({ ...base, legalForm: "TOO", binIin: "210140000017" }).success).toBe(false);
  });

  it("ТОО — ФИО и ИИН директора обязательны и проверяются", () => {
    const too = { phone: "+77001112233", legalForm: "TOO", legalName: "ТОО Тест", binIin: "210140000016", segment: "ECONOMY" };
    const fields = (input: object) => {
      const r = addExecutorSchema.safeParse(input);
      return Object.keys(r.error ? z.flattenError(r.error).fieldErrors : {}).sort();
    };
    expect(fields(too)).toEqual(["directorIin", "directorName"]);
    expect(fields({ ...too, directorName: "Тулегенов", directorIin: "900101300018" })).toEqual(["directorIin", "directorName"]);
    expect(addExecutorSchema.parse({ ...too, directorName: " Тулегенов  Бауыржан ", directorIin: "9001 0130 0017" }).signer).toEqual({
      fullName: "Тулегенов Бауыржан",
      iin: "900101300017",
    });
  });

  it("ИП — ФИО владельца обязательно, самозанятый — наименование и есть ФИО: правила анкеты исполнителя", () => {
    const base = { phone: "+77001112233", binIin: "900101300017", segment: "ECONOMY" };
    const fields = (input: object) => {
      const r = addExecutorSchema.safeParse(input);
      return Object.keys(r.error ? z.flattenError(r.error).fieldErrors : {}).sort();
    };
    expect(fields({ ...base, legalForm: "IP", legalName: "ИП «Дала»" })).toEqual(["ownerName"]);
    expect(fields({ ...base, legalForm: "SELF_EMPLOYED", legalName: "Тест" })).toEqual(["legalName"]);
    expect(addExecutorSchema.parse({ ...base, legalForm: "SELF_EMPLOYED", legalName: "Тестов Тест" }).signer).toEqual({ fullName: "Тестов Тест", iin: null });
  });

  it("сообщает, какое поле неверно", () => {
    const result = addExecutorSchema.safeParse({ phone: "1", legalForm: "IP", legalName: "", ownerName: "Тестов Тест", binIin: "1", segment: "ECONOMY" });
    expect(result.success).toBe(false);
    expect(Object.keys(result.error ? z.flattenError(result.error).fieldErrors : {}).sort()).toEqual(["binIin", "legalName", "phone"]);
  });
});

describe("решение по спору", () => {
  it("для частичного решения требует сумму", () => {
    expect(resolveDisputeSchema.safeParse({ disputeId: "d", decision: "PARTIAL", rationale: "Работа выполнена наполовину" }).success).toBe(false);
    expect(
      resolveDisputeSchema.safeParse({ disputeId: "d", decision: "PARTIAL", decisionAmount: "50000", rationale: "Работа выполнена наполовину" }).data,
    ).toMatchObject({ decisionAmount: 50000 });
  });

  it("для других решений сумму не сохраняет", () => {
    expect(
      resolveDisputeSchema.parse({ disputeId: "d", decision: "FAVOR_CLIENT", decisionAmount: "1", rationale: "Фото подтверждают дефект" }),
    ).not.toHaveProperty("decisionAmount");
  });
});

describe("фильтр журнала", () => {
  it("пустые поля формы превращает в отсутствие фильтра, даты — в границы дня", () => {
    const f = auditFilterSchema.parse({ entityType: "", scope: "deal:abc", from: "2026-10-01", to: "2026-10-02", before: "" });
    expect(f.entityType).toBeUndefined();
    expect(f.scope).toBe("deal:abc");
    expect(f.from?.toISOString()).toBe("2026-09-30T19:00:00.000Z"); // полночь в Астане (UTC+5)
    expect(f.to?.toISOString()).toBe("2026-10-02T18:59:59.999Z");
  });

  it("курсор — целое число seq", () => {
    expect(auditFilterSchema.parse({ before: "120" }).before).toBe(120n);
    expect(auditFilterSchema.safeParse({ before: "1e3" }).success).toBe(false);
  });
});
