import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";

/** Образцы аргументов текстов-функций: суммы строкой и числа (склонения). */
const SAMPLES: readonly unknown[][] = [
  ["1 000 ₸", "1 000 ₸", "1 000 ₸"],
  [2, 5, "Шаг"],
];

/** Все строки словаря; функции вызываются с образцами аргументов, чтобы проверить и собранные из них тексты. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "function") {
    const made = SAMPLES.flatMap((args) => {
      try {
        return strings((value as (...a: unknown[]) => unknown)(...args));
      } catch {
        // Функция не принимает этот образец (например, ждёт число) — проверит другой.
        return [];
      }
    });
    return [...new Set(made)];
  }
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

/** Формула гарантии мастера — единственное место, где допустимо слово «клиент». */
const GUARANTEE = "Гарантия оплаты и клиента (4%)";

type Zone = keyof typeof ru.app;

/** Зоны только покупателя: мастер их не видит, у них свой тест (`buyer-words.test.ts`). */
const BUYER_ONLY: readonly Zone[] = ["buyer", "requests", "requestCard", "offer"];

// Зоны мастера: `master.ts` и `master-*.ts` подключаются в `ru.app` под именами `master…`.
const zones = Object.keys(ru.app) as Zone[];
const MASTER_ZONES = zones.filter((name) => name.startsWith("master"));
// Общие зоны: всё, что не только покупателя и не только мастера (оболочка, kit, вход, первые шаги, гость, сделка, чаты, профиль).
const SHARED_ZONES = zones.filter((name) => !name.startsWith("master") && !BUYER_ONLY.includes(name));

const master = MASTER_ZONES.flatMap((name) => strings(ru.app[name]));
const shared = SHARED_ZONES.flatMap((name) => strings(ru.app[name]));

/** Запреты обеих сторон: их не должно быть ни в зонах мастера, ни в общих зонах, которые он видит. */
const BOTH_SIDES: [string, RegExp][] = [
  ["комисси", /комисси/i],
  ["эскроу", /эскроу/i],
  ["платформ", /платформ/i],
  ["демо", /(^|[^а-яё])демо/i],
  ["тестов", /тестов/i],
  ["отклик", /отклик/i],
];

/** Деньги не проходят через счета сервиса (ТЗ, ADR-009): ни одной формулировки о том, что проходят. */
const MONEY_THROUGH_US = /сч[её]т[а-яё]*\s+(сервиса|ТОО)|через нас([^а-яё]|$)|на наш сч[её]т|через сервис/i;
/** Законное отрицание («Деньги не проходят через счета сервиса») вырезается перед проверкой. */
const NEGATED = /не\s+(проход|поступа|ид)[а-яё]*\s+через\s+сч[её]т[а-яё]*\s+(сервиса|ТОО)/gi;
const saysThroughUs = (s: string): boolean => MONEY_THROUGH_US.test(s.replace(NEGATED, ""));

const BUYER_PROTECTION = /2\s?%|защит[аыеу] сделки/i;

describe("тексты мастера: запретные слова", () => {
  it("зоны мастера и общие зоны найдены и не пусты", () => {
    expect(MASTER_ZONES).toContain("master");
    expect(master.length).toBeGreaterThan(50);
    expect(SHARED_ZONES).toEqual(expect.arrayContaining(["shell", "kit", "chat", "profile", "deal", "login", "onboarding", "guest"]));
    expect(shared.length).toBeGreaterThan(200);
  });

  it.each(BOTH_SIDES)("нет слова «%s» — ни в зонах мастера, ни в общих зонах", (_word, pattern) => {
    expect(master.filter((s) => pattern.test(s))).toEqual([]);
    expect(shared.filter((s) => pattern.test(s))).toEqual([]);
  });

  it("в зонах мастера нет слова «заказчик»", () => {
    expect(master.filter((s) => /заказчик/i.test(s))).toEqual([]);
  });

  // «выплат» и «договор» (Ruling 9: «оплата», «оферта») запрещены в зонах, где слова уже решены: сделка мастера
  // (`ru.app.master`), регистрация мастера (`ru.app.masterRegister`) и заявка с предложением (`ru.app.masterOffer`). Остальные
  // зоны `master-*` добавляются сюда, когда их тексты приведены к решению.
  const DECIDED: readonly Zone[] = ["master", "masterDeal", "masterRegister", "masterOffer", "masterCompany", "masterFinance", "masterPortfolio", "masterProfile", "masterDispute", "masterMoney"];
  it.each([
    ["выплат", /выплат/i],
    ["договор", /(^|[^а-яё])договор(?!ит|ён)/i],
  ])("в зонах сделки, регистрации и предложения мастера нет слова «%s»", (_word, pattern) => {
    expect(DECIDED.flatMap((name) => strings(ru.app[name])).filter((s) => pattern.test(s))).toEqual([]);
  });

  it("«клиент» — только в формуле «Гарантия оплаты и клиента (4%)»", () => {
    expect(master.filter((s) => /клиент/i.test(s.replaceAll(GUARANTEE, "")))).toEqual([]);
    expect(ru.app.master.deal.money.guarantee).toBe(GUARANTEE);
  });

  it("мастер видит «Вы получите»; защиты сделки покупателя (2%) в текстах мастера нет", () => {
    expect(ru.app.master.deal.money.youGet).toBe("Вы получите");
    expect(master.filter((s) => BUYER_PROTECTION.test(s))).toEqual([]);
  });

  it("нигде не сказано, что деньги проходят через счета сервиса или ТОО", () => {
    expect(master.filter(saysThroughUs)).toEqual([]);
    expect(shared.filter(saysThroughUs)).toEqual([]);
  });

  it("сам тест ловит запретное (проверка проверки)", () => {
    expect(strings({ a: ["Комиссия"], b: () => "клиент" }).filter((s) => /комисси|клиент/i.test(s))).toHaveLength(2);
    for (const s of ["Деньги придут на счёт сервиса", "переведите на наш счёт", "оплата идёт через нас", "на счёт ТОО", "на счета ТОО"]) {
      expect(saysThroughUs(s), s).toBe(true);
    }
    expect(saysThroughUs("Деньги не проходят через счета сервиса: они в банке")).toBe(false);
    expect(BUYER_PROTECTION.test("без защиты сделки")).toBe(true);
  });
});
