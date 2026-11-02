import { describe, expect, it } from "vitest";
import { z } from "zod";
import { addExecutorSchema, auditFilterSchema, bankConfirmFieldsSchema, incomePeriodSchema, resolveDisputeSchema } from "./schemas";

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
  it("для частичного раздела требует сумму мастеру; тенге с пробелами → тиыны", () => {
    expect(resolveDisputeSchema.safeParse({ disputeId: "d", outcome: "PARTIAL_SPLIT", masterShareKzt: "", rationale: "Работа выполнена наполовину" }).success).toBe(false);
    expect(
      resolveDisputeSchema.parse({ disputeId: "d", outcome: "PARTIAL_SPLIT", masterShareKzt: "750 000", rationale: "Работа выполнена наполовину" }),
    ).toEqual({ disputeId: "d", outcome: "PARTIAL_SPLIT", masterShareTiyn: 75_000_000n, rationale: "Работа выполнена наполовину" });
    expect(resolveDisputeSchema.safeParse({ disputeId: "d", outcome: "PARTIAL_SPLIT", masterShareKzt: "100,5", rationale: "Работа выполнена наполовину" }).success).toBe(false);
  });

  it("для других итогов сумму не передаёт; обоснование обязательно", () => {
    expect(resolveDisputeSchema.parse({ disputeId: "d", outcome: "CONTINUE", masterShareKzt: "1", rationale: "Фото подтверждают дефект" })).not.toHaveProperty("masterShareTiyn");
    expect(resolveDisputeSchema.safeParse({ disputeId: "d", outcome: "FULL_REFUND", rationale: "коротко" }).success).toBe(false);
    expect(resolveDisputeSchema.safeParse({ disputeId: "d", outcome: "FAVOR_CLIENT", rationale: "Фото подтверждают дефект" }).success).toBe(false);
  });
});

describe("подтверждение операции банка", () => {
  it("номер и дата обязательны; дата — день по Астане", () => {
    expect(bankConfirmFieldsSchema.parse({ transactionId: "t", bankDocNumber: " ПП-17 ", bankDocDate: "2026-11-02" })).toEqual({
      transactionId: "t",
      bankDocNumber: "ПП-17",
      bankDocDate: new Date("2026-11-01T19:00:00.000Z"),
    });
    expect(bankConfirmFieldsSchema.safeParse({ transactionId: "t", bankDocNumber: "", bankDocDate: "2026-11-02" }).success).toBe(false);
    expect(bankConfirmFieldsSchema.safeParse({ transactionId: "t", bankDocNumber: "1", bankDocDate: "02.11.2026" }).success).toBe(false);
  });
});

describe("период отчёта о доходе", () => {
  it("«по» включительно: до начала следующего дня по Астане; «с» позже «по» — ошибка", () => {
    expect(incomePeriodSchema.parse({ from: "2026-11-01", to: "2026-11-30" })).toEqual({
      from: new Date("2026-10-31T19:00:00.000Z"),
      to: new Date("2026-11-30T19:00:00.000Z"),
    });
    expect(incomePeriodSchema.safeParse({ from: "2026-11-02", to: "2026-11-01" }).success).toBe(false);
    expect(incomePeriodSchema.parse({ from: "2026-11-01", to: "2026-11-01" }).to).toEqual(new Date("2026-11-01T19:00:00.000Z"));
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

  it("номер сделки — целое число", () => {
    expect(auditFilterSchema.parse({ deal: "42" }).deal).toBe(42);
    expect(auditFilterSchema.parse({ deal: "" }).deal).toBeUndefined();
    expect(auditFilterSchema.safeParse({ deal: "abc" }).success).toBe(false);
  });

  it("курсор — целое число seq", () => {
    expect(auditFilterSchema.parse({ before: "120" }).before).toBe(120n);
    expect(auditFilterSchema.safeParse({ before: "1e3" }).success).toBe(false);
  });
});
