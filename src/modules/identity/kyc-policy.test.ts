import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { KYC_TRANSITIONS, kycTarget, kycView } from "./kyc-policy";

const code = (run: () => unknown) => {
  try {
    run();
    return "OK";
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
};

describe("KYC мастера (решение 2.2.8): таблица переходов", () => {
  it("загрузка — из «на проверке» и «отклонено» в «на проверке»; решение оператора — только из «на проверке»", () => {
    expect(KYC_TRANSITIONS).toEqual({
      submit: { from: ["PENDING", "REJECTED"], to: "PENDING", who: "EXECUTOR" },
      verify: { from: ["PENDING"], to: "VERIFIED", who: "OPERATOR" },
      reject: { from: ["PENDING"], to: "REJECTED", who: "OPERATOR" },
    });
  });

  it.each([
    ["submit", "PENDING", false, "EXECUTOR", "PENDING"],
    ["submit", "PENDING", true, "EXECUTOR", "PENDING"],
    ["submit", "REJECTED", true, "EXECUTOR", "PENDING"],
    ["verify", "PENDING", true, "OPERATOR", "VERIFIED"],
    ["reject", "PENDING", true, "OPERATOR", "REJECTED"],
  ] as const)("разрешено: %s из %s (документы: %s) ролью %s → %s", (action, status, hasDocuments, who, to) => {
    expect(kycTarget(action, { status, hasDocuments }, who)).toBe(to);
  });

  it.each([
    // не та роль
    ["submit", "PENDING", false, "CLIENT", "FORBIDDEN"],
    ["submit", "PENDING", false, "OPERATOR", "FORBIDDEN"],
    ["verify", "PENDING", true, "EXECUTOR", "FORBIDDEN"],
    ["verify", "PENDING", true, "CLIENT", "FORBIDDEN"],
    ["reject", "PENDING", true, "EXECUTOR", "FORBIDDEN"],
    // не то состояние: повтор, двойной клик, загрузка поверх проверенных
    ["submit", "VERIFIED", true, "EXECUTOR", "CONFLICT"],
    ["verify", "VERIFIED", true, "OPERATOR", "CONFLICT"],
    ["verify", "REJECTED", true, "OPERATOR", "CONFLICT"],
    ["reject", "REJECTED", true, "OPERATOR", "CONFLICT"],
    ["reject", "VERIFIED", true, "OPERATOR", "CONFLICT"],
    // решать нечего: документов ещё нет
    ["verify", "PENDING", false, "OPERATOR", "CONFLICT"],
    ["reject", "PENDING", false, "OPERATOR", "CONFLICT"],
  ] as const)("запрещено: %s из %s (документы: %s) ролью %s — %s", (action, status, hasDocuments, who, expected) => {
    expect(code(() => kycTarget(action, { status, hasDocuments }, who))).toBe(expected);
  });
});

describe("сообщения отказа — понятные мастеру и оператору", () => {
  const message = (run: () => unknown) => {
    try {
      run();
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  };
  it("загрузка поверх проверенных — «уже проверены», повторное решение — «уже рассмотрены», без документов — «не загрузил»", () => {
    const errors = ru.identity.kyc.errors;
    expect(message(() => kycTarget("submit", { status: "VERIFIED", hasDocuments: true }, "EXECUTOR"))).toBe(errors.alreadyVerified);
    expect(message(() => kycTarget("verify", { status: "VERIFIED", hasDocuments: true }, "OPERATOR"))).toBe(errors.reviewed);
    expect(message(() => kycTarget("reject", { status: "PENDING", hasDocuments: false }, "OPERATOR"))).toBe(errors.noDocuments);
  });
});

describe("что видит мастер", () => {
  it("«на проверке» без документов — ещё не загружены; кнопка загрузки — пока документы не проверены", () => {
    expect(kycView({ status: "PENDING", hasDocuments: false })).toEqual({ state: "NOT_SUBMITTED", canSubmit: true });
    expect(kycView({ status: "PENDING", hasDocuments: true })).toEqual({ state: "PENDING", canSubmit: true });
    expect(kycView({ status: "REJECTED", hasDocuments: true })).toEqual({ state: "REJECTED", canSubmit: true });
    expect(kycView({ status: "REJECTED", hasDocuments: false })).toEqual({ state: "REJECTED", canSubmit: true });
    expect(kycView({ status: "VERIFIED", hasDocuments: true })).toEqual({ state: "VERIFIED", canSubmit: false });
  });
});
