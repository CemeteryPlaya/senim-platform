import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";

/** Все строки словаря (значения и результаты функций с числовыми аргументами не проверяются — только строки). */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

const a = ru.app;
// Тексты пути покупателя: главная, заявки, предложение, сделки, помощь, первые шаги.
const BUYER = [a.buyer, a.requests, a.requestCard, a.offer, a.deal, a.chat, a.profile, a.onboarding, a.shell];

describe("тексты пути покупателя к одному виду", () => {
  it("мастер получает «оплату», не «выплату»", () => {
    const found = BUYER.flatMap(strings).filter((s) => /выплат/i.test(s));
    expect(found).toEqual([]);
  });

  it("покупателю — «оферта» и «сделка», не «договор»", () => {
    expect(BUYER.flatMap(strings).filter((s) => /(^|[^а-яё])договор(?!ит|ён)/i.test(s))).toEqual([]);
  });

  it("ссылка на документ — «Открыть» и вид документа, без «Открыть документ»", () => {
    expect(strings(a).filter((s) => s.includes("Открыть документ"))).toEqual([]);
    expect(Object.values(a.deal.openDocument).every((s) => /^Открыть [а-яё]+$/.test(s))).toBe(true);
  });

  it("главное действие покупателя называется одинаково: шапка, «Мои заявки», главная, сделки", () => {
    expect(new Set([a.shell.order, a.requests.list.create, a.buyer.home.now.order.action, a.deal.list.order])).toEqual(new Set(["Заказать мебель"]));
  });

  it("подпись: кнопка экрана называет документ так же, как действие карточки сделки", () => {
    expect(a.deal.sign.hand.submit.CONTRACT).toBe(a.deal.card.now.signOffer.action);
    expect(a.deal.sign.ecp.start.CONTRACT).toBe(a.deal.card.now.signOffer.action);
    expect(a.deal.sign.hand.submit.ACCEPTANCE_ACT).toBe("Подписать акт");
  });
});
