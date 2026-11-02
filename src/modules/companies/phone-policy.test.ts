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

/** Поговорили, чат открыт, телефон скрыт — исходное состояние, из которого показать можно. */
const ready: ClientPhoneFacts = { state: "HIDDEN", talked: true, chatClosed: null };

describe("телефон заказчика (№21): таблица переходов", () => {
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
    ["share", { ...ready, state: "SHOWN" }, "client", "CONFLICT"],
    ["revoke", ready, "client", "CONFLICT"],
    ["share", { ...ready, talked: false }, "client", "CONFLICT"],
    ["share", { ...ready, chatClosed: "offerDeclined" }, "client", "CONFLICT"],
    ["share", { ...ready, chatClosed: "operatorClosed" }, "client", "CONFLICT"],
  ] as const)("%s из %o стороной %s — %s", (action, facts, who, expected) => {
    expect(code(() => clientPhoneTarget(action, facts, who))).toBe(expected);
  });

  it("скрыть можно и в закрытом чате: отзыв согласия не зависит от состояния отклика", () => {
    expect(clientPhoneTarget("revoke", { state: "SHOWN", talked: true, chatClosed: "requestCancelled" }, "client")).toBe("HIDDEN");
  });
});

describe("кнопка «Показать телефон» и видимость номера", () => {
  it("кнопка есть, только когда показать можно", () => {
    expect(canShareClientPhone(ready)).toBe(true);
    expect(canShareClientPhone({ ...ready, talked: false })).toBe(false);
    expect(canShareClientPhone({ ...ready, chatClosed: "offerWithdrawn" })).toBe(false);
    expect(canShareClientPhone({ ...ready, state: "SHOWN" })).toBe(false);
  });

  it("исполнитель видит номер, пока согласие действует и чат открыт", () => {
    expect(executorSeesClientPhone({ state: "SHOWN", chatClosed: null })).toBe(true);
    expect(executorSeesClientPhone({ state: "HIDDEN", chatClosed: null })).toBe(false);
    expect(executorSeesClientPhone({ state: "SHOWN", chatClosed: "offerDeclined" })).toBe(false);
    expect(executorSeesClientPhone({ state: "SHOWN", chatClosed: "operatorClosed" })).toBe(false);
  });
});
