import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";

/** Все строки словаря; функции вызываются с образцами аргументов, чтобы проверить и собранные из них тексты. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "function") return strings((value as (...args: unknown[]) => unknown)("1 000 ₸", "1 000 ₸"));
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

/** Формула гарантии мастера — единственное место, где допустимо слово «клиент». */
const GUARANTEE = "Гарантия оплаты и клиента (4%)";

// Зоны мастера: `master.ts` и будущие `master-*.ts` подключаются в `ru.app` под именами `master…`.
const MASTER = Object.entries(ru.app)
  .filter(([name]) => name.startsWith("master"))
  .map(([, zone]) => zone);
const all = MASTER.flatMap(strings);

describe("тексты мастера: запретные слова", () => {
  it("зона мастера подключена в ru.app и не пуста", () => {
    expect(MASTER.length).toBeGreaterThan(0);
    expect(all.length).toBeGreaterThan(50);
  });

  it.each([
    ["комисси", /комисси/i],
    ["эскроу", /эскроу/i],
    ["платформ", /платформ/i],
    ["демо", /(^|[^а-яё])демо/i],
    ["тестов", /тестов/i],
    ["отклик", /отклик/i],
    ["заказчик", /заказчик/i],
  ])("нет слова «%s»", (_word, pattern) => {
    expect(all.filter((s) => pattern.test(s))).toEqual([]);
  });

  it("«клиент» — только в формуле «Гарантия оплаты и клиента (4%)»", () => {
    expect(all.filter((s) => /клиент/i.test(s.replaceAll(GUARANTEE, "")))).toEqual([]);
    expect(ru.app.master.deal.money.guarantee).toBe(GUARANTEE);
  });

  it("мастер видит «Вы получите»; защиты сделки покупателя (2%) в текстах мастера нет", () => {
    expect(ru.app.master.deal.money.youGet).toBe("Вы получите");
    expect(all.filter((s) => /2\s?%|защита сделки/i.test(s))).toEqual([]);
  });

  it("нигде не сказано, что деньги проходят через счета сервиса", () => {
    expect(all.filter((s) => /счет[ау]? сервиса|счёт[ау]? сервиса|через сервис/i.test(s))).toEqual([]);
  });

  it("сам тест ловит запретное слово (проверка проверки)", () => {
    expect(strings({ a: ["Комиссия"], b: () => "клиент" }).filter((s) => /комисси|клиент/i.test(s))).toHaveLength(2);
  });
});
