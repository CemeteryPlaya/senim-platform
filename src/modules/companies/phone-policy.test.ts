import { describe, expect, it } from "vitest";
import { canShareClientPhone, CLIENT_PHONE, clientPhoneTarget, executorSeesClientPhone, type ClientPhoneFacts } from "./phone-policy";

const code = (run: () => unknown) => {
  try {
    run();
    return "OK";
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
};

/** Флаг включён, до оферты, поговорили, чат открыт, телефон скрыт — исходное состояние, из которого показать можно. */
const ready: ClientPhoneFacts = { state: "HIDDEN", talked: true, chatClosed: null, consentEnabled: true, stage: "BEFORE_OFFER" };

describe("телефон заказчика до оферты (ADR-008, флаг clientPhoneConsent): таблица переходов", () => {
  it("показать — из «скрыт», скрыть — из «показан»; только заказчик заявки", () => {
    expect(CLIENT_PHONE).toEqual({
      share: { from: "HIDDEN", to: "SHOWN", who: "client" },
      revoke: { from: "SHOWN", to: "HIDDEN", who: "client" },
    });
    expect(clientPhoneTarget("share", ready, "client")).toBe("SHOWN");
    expect(clientPhoneTarget("revoke", { ...ready, state: "SHOWN" }, "client")).toBe("HIDDEN");
  });

  it.each([
    ["share", ready, "executor", "FORBIDDEN"],
    ["share", ready, "operator", "FORBIDDEN"],
    ["revoke", { ...ready, state: "SHOWN" }, "executor", "FORBIDDEN"],
    ["revoke", { ...ready, state: "SHOWN" }, "operator", "FORBIDDEN"],
    ["share", { ...ready, consentEnabled: false }, "client", "FORBIDDEN"],
    ["share", { ...ready, stage: "AFTER_OFFER" }, "client", "CONFLICT"],
    ["share", { ...ready, state: "SHOWN" }, "client", "CONFLICT"],
    ["revoke", ready, "client", "CONFLICT"],
    ["share", { ...ready, talked: false }, "client", "CONFLICT"],
    ["share", { ...ready, chatClosed: "offerDeclined" }, "client", "CONFLICT"],
    ["share", { ...ready, chatClosed: "operatorClosed" }, "client", "CONFLICT"],
  ] as const)("%s из %o стороной %s — %s", (action, facts, who, expected) => {
    expect(code(() => clientPhoneTarget(action, facts, who))).toBe(expected);
  });

  it("скрыть можно всегда: в закрытом чате, после оферты и при выключенном флаге", () => {
    const shown = { ...ready, state: "SHOWN" } as const;
    expect(clientPhoneTarget("revoke", { ...shown, chatClosed: "requestCancelled" }, "client")).toBe("HIDDEN");
    expect(clientPhoneTarget("revoke", { ...shown, stage: "AFTER_OFFER" }, "client")).toBe("HIDDEN");
    expect(clientPhoneTarget("revoke", { ...shown, consentEnabled: false }, "client")).toBe("HIDDEN");
  });
});

describe("кнопка «Показать телефон» и видимость номера до оферты", () => {
  it("кнопка есть, только когда показать можно", () => {
    expect(canShareClientPhone(ready)).toBe(true);
    expect(canShareClientPhone({ ...ready, consentEnabled: false })).toBe(false);
    expect(canShareClientPhone({ ...ready, stage: "AFTER_OFFER" })).toBe(false);
    expect(canShareClientPhone({ ...ready, talked: false })).toBe(false);
    expect(canShareClientPhone({ ...ready, chatClosed: "offerWithdrawn" })).toBe(false);
    expect(canShareClientPhone({ ...ready, state: "SHOWN" })).toBe(false);
  });

  it("исполнитель видит номер по согласию, пока флаг включён, оферты нет и чат открыт", () => {
    const shown = { state: "SHOWN", chatClosed: null, consentEnabled: true, stage: "BEFORE_OFFER" } as const;
    expect(executorSeesClientPhone(shown)).toBe(true);
    expect(executorSeesClientPhone({ ...shown, state: "HIDDEN" })).toBe(false);
    expect(executorSeesClientPhone({ ...shown, chatClosed: "offerDeclined" })).toBe(false);
    expect(executorSeesClientPhone({ ...shown, chatClosed: "operatorClosed" })).toBe(false);
    // Флаг выключили после согласия — номер больше не виден до оферты.
    expect(executorSeesClientPhone({ ...shown, consentEnabled: false })).toBe(false);
    // После оферты номер приходит через контакты сторон, а не через согласие.
    expect(executorSeesClientPhone({ ...shown, stage: "AFTER_OFFER" })).toBe(false);
  });
});
