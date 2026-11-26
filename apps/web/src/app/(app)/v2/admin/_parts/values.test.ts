import { describe, expect, it } from "vitest";
import { isIdField, phoneFields } from "./values";

const fieldsOf = (...names: string[]) => names.map((name) => ({ name }));

describe("phoneFields: столбцы карточки таблицы на телефоне", () => {
  it("Deal — номер, название, цена, статус и дата; ключ и связи — нет", () => {
    const deal = fieldsOf("id", "number", "requestId", "offerId", "clientId", "executorId", "title", "priceTiyn", "status", "durationDays", "createdAt", "signedAt");
    expect(phoneFields(deal, "id")).toEqual(["number", "title", "priceTiyn", "status", "createdAt"]);
  });

  it("без узнаваемых полей — первые поля, кроме связей …Id, не больше пяти", () => {
    expect(phoneFields(fieldsOf("id", "dealId", "a", "b", "c", "d", "e", "f"), "id")).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("таблица без ключа — заголовок строки первый столбец, остальные по тем же правилам", () => {
    expect(phoneFields(fieldsOf("userId", "role", "createdAt"), null)).toEqual(["createdAt"]);
  });
});

describe("isIdField: id без переноса", () => {
  it("ключ записи и связи …Id — да, прочее — нет", () => {
    expect(isIdField("id", "id")).toBe(true);
    expect(isIdField("clientId", "id")).toBe(true);
    expect(isIdField("title", "id")).toBe(false);
    expect(isIdField("number", null)).toBe(false);
  });
});
