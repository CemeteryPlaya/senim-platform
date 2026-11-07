import { describe, expect, it } from "vitest";
import { chatTextRule, CONTACTS, contactStage, seesPartyContacts } from "./contacts-policy";

describe("контакты сторон (ТЗ п. 3): стадия — заключена ли оферта", () => {
  it("нет сделки или оферта не подписана — до оферты; Deal.signedAt заполнен — после", () => {
    expect(contactStage(null)).toBe("BEFORE_OFFER");
    expect(contactStage({ signedAt: null })).toBe("BEFORE_OFFER");
    expect(contactStage({ signedAt: new Date() })).toBe("AFTER_OFFER");
  });
});

describe("контакты сторон: таблица правил", () => {
  it("до оферты — маска в чате у обеих сторон и контакты не видны никому; после — текст как есть и контакты видны сторонам", () => {
    expect(CONTACTS).toEqual({
      BEFORE_OFFER: {
        text: { client: "maskContacts", executor: "maskContactsAndName" },
        contacts: { client: false, executor: false, operator: false },
      },
      AFTER_OFFER: {
        text: { client: "asIs", executor: "asIs" },
        contacts: { client: true, executor: true, operator: false },
      },
    });
  });

  it.each([
    ["BEFORE_OFFER", "client", "maskContacts"],
    ["BEFORE_OFFER", "executor", "maskContactsAndName"],
    ["AFTER_OFFER", "client", "asIs"],
    ["AFTER_OFFER", "executor", "asIs"],
  ] as const)("текст в чате: %s, сторона %s — %s", (stage, party, rule) => {
    expect(chatTextRule(stage, party)).toBe(rule);
  });

  it.each([
    ["BEFORE_OFFER", "client", false],
    ["BEFORE_OFFER", "executor", false],
    ["BEFORE_OFFER", "operator", false],
    ["AFTER_OFFER", "client", true],
    ["AFTER_OFFER", "executor", true],
    // Оператор видит телефоны в своей панели, как раньше; в чате и карточке сделки блока контактов нет.
    ["AFTER_OFFER", "operator", false],
  ] as const)("контакты другой стороны: %s, сторона %s — %s", (stage, party, sees) => {
    expect(seesPartyContacts(stage, party)).toBe(sees);
  });
});
