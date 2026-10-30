import { describe, expect, it } from "vitest";
import { z } from "zod";
import { addExecutorSchema, auditFilterSchema, isValidKzId, normalizePhone, resolveDisputeSchema } from "./schemas";

describe("ИИН/БИН", () => {
  it("принимает номер с верной контрольной цифрой", () => {
    expect(isValidKzId("210140000016")).toBe(true);
  });

  it("отклоняет неверную контрольную цифру, буквы и неверную длину", () => {
    expect(isValidKzId("210140000017")).toBe(false);
    expect(isValidKzId("21014000001a")).toBe(false);
    expect(isValidKzId("2101400000")).toBe(false);
  });
});

describe("телефон", () => {
  it("приводит казахстанский номер к +7XXXXXXXXXX", () => {
    expect(normalizePhone("+7 (700) 111-22-33")).toBe("+77001112233");
    expect(normalizePhone("87001112233")).toBe("+77001112233");
  });

  it("не принимает короткий или чужой номер", () => {
    expect(normalizePhone("+7 700 111")).toBeNull();
    expect(normalizePhone("+1 202 555 0100")).toBeNull();
  });
});

describe("форма ручного добавления", () => {
  it("разбирает форму и чистит пробелы в ИИН/БИН", () => {
    const parsed = addExecutorSchema.parse({
      phone: "8 700 111 22 33",
      legalForm: "IP",
      legalName: "  ИП Тест ",
      binIin: "2101 4000 0016",
      segment: "ECONOMY",
    });
    expect(parsed).toEqual({ phone: "+77001112233", legalForm: "IP", legalName: "ИП Тест", binIin: "210140000016", segment: "ECONOMY" });
  });

  it("сообщает, какое поле неверно", () => {
    const result = addExecutorSchema.safeParse({ phone: "1", legalForm: "IP", legalName: "", binIin: "1", segment: "ECONOMY" });
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
