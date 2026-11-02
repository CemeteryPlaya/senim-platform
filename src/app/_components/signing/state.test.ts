import { describe, expect, it } from "vitest";
import { initialSigningState, focusTargetAfter, signStep, signingReducer, type SigningSessionView } from "./state";

const session: SigningSessionView = { sessionId: "s1", method: "EGOV_QR", qrImage: "data:image/png;base64,AA", expiresAt: new Date(0), provider: "mock" };

describe("signingReducer", () => {
  it("выбор способа → старт → ожидание с QR → проверка → готово", () => {
    let s = initialSigningState;
    s = signingReducer(s, { type: "method", method: "NCALAYER" });
    expect(s).toMatchObject({ step: "choose", method: "NCALAYER" });
    s = signingReducer(s, { type: "start" });
    expect(s).toMatchObject({ step: "starting", method: "NCALAYER" });
    s = signingReducer(s, { type: "started", session });
    expect(s).toMatchObject({ step: "awaiting", session });
    s = signingReducer(s, { type: "complete" });
    expect(s).toMatchObject({ step: "completing" });
    s = signingReducer(s, { type: "completed", fullySigned: true });
    expect(s).toEqual({ step: "done", fullySigned: true });
  });

  it("ошибка старта возвращает к выбору с сообщением", () => {
    const s = signingReducer(signingReducer(initialSigningState, { type: "start" }), { type: "failed", error: "Нет связи" });
    expect(s).toMatchObject({ step: "choose", error: "Нет связи" });
  });

  it("подпись ещё не получена — остаёмся в ожидании той же сессии с сообщением", () => {
    const awaiting = signingReducer(signingReducer(initialSigningState, { type: "start" }), { type: "started", session });
    const s = signingReducer(signingReducer(awaiting, { type: "complete" }), { type: "failed", error: "Подпись ещё не получена" });
    expect(s).toMatchObject({ step: "awaiting", session, error: "Подпись ещё не получена" });
  });

  it("«Выбрать другой способ» сбрасывает сессию", () => {
    const awaiting = signingReducer(signingReducer(initialSigningState, { type: "start" }), { type: "started", session });
    expect(signingReducer(awaiting, { type: "reset" })).toEqual({ step: "choose", method: "EGOV_QR" });
  });

  it("ошибка и сброс вне своих шагов ничего не меняют; сброс из выбора убирает ошибку", () => {
    const awaiting = signingReducer(signingReducer(initialSigningState, { type: "start" }), { type: "started", session });
    expect(signingReducer(awaiting, { type: "failed", error: "x" })).toBe(awaiting);
    expect(signingReducer(initialSigningState, { type: "failed", error: "x" })).toBe(initialSigningState);
    const starting = signingReducer(initialSigningState, { type: "start" });
    expect(signingReducer(starting, { type: "reset" })).toBe(starting);
    const withError = signingReducer(starting, { type: "failed", error: "Нет связи" });
    expect(signingReducer(withError, { type: "reset" })).toEqual({ step: "choose", method: "EGOV_QR" });
  });

  it("действия не по порядку игнорируются (двойное нажатие)", () => {
    const starting = signingReducer(initialSigningState, { type: "start" });
    expect(signingReducer(starting, { type: "start" })).toBe(starting);
    expect(signingReducer(initialSigningState, { type: "complete" })).toBe(initialSigningState);
  });
});

describe("signStep — какой шаг подписи показать стороне", () => {
  const sig = (party: "CLIENT" | "EXECUTOR", hand: boolean, ecp: boolean) => ({
    party,
    required: { hand: true, ecp: true },
    hand: hand ? { signedAt: new Date(0), documentSha256: "a", typed: true } : null,
    ecp: ecp ? { signedAt: new Date(0), signedSha256: "a", method: "EGOV_QR" as const } : null,
  });
  const doc = {
    status: "SIGNING" as const,
    signable: true,
    myParty: "CLIENT" as const,
    canSign: { hand: false, ecp: false },
    parties: [sig("CLIENT", false, false), sig("EXECUTOR", false, false)],
  };

  it("сначала собственноручная подпись, потом ЭЦП", () => {
    expect(signStep({ ...doc, canSign: { hand: true, ecp: true } })).toBe("hand");
    expect(signStep({ ...doc, canSign: { hand: false, ecp: true } })).toBe("ecp");
  });

  it("мои подписи все есть — «Вы поставили все подписи»; нет, а подписать нельзя — шаг сделки не тот", () => {
    expect(signStep({ ...doc, parties: [sig("CLIENT", true, true), sig("EXECUTOR", false, false)] })).toBe("youSigned");
    expect(signStep(doc)).toBe("notSignable");
    expect(signStep({ ...doc, parties: [sig("CLIENT", false, false), sig("EXECUTOR", true, true)] })).toBe("notSignable");
  });

  it("подпись, которая стороне не требуется, не мешает «Вы поставили все подписи» (мастер на акте)", () => {
    const executor = { ...sig("EXECUTOR", false, true), required: { hand: false, ecp: true } };
    expect(signStep({ ...doc, myParty: "EXECUTOR", parties: [sig("CLIENT", false, false), executor] })).toBe("youSigned");
    const noEcp = { ...sig("EXECUTOR", true, false), required: { hand: true, ecp: false } };
    expect(signStep({ ...doc, myParty: "EXECUTOR", parties: [noEcp] })).toBe("youSigned");
    expect(signStep({ ...doc, myParty: "EXECUTOR", parties: [sig("EXECUTOR", true, false)] })).toBe("notSignable");
    expect(signStep({ ...doc, myParty: "EXECUTOR", parties: [sig("EXECUTOR", false, true)] })).toBe("notSignable");
    expect(signStep({ ...doc, myParty: "EXECUTOR", parties: [] })).toBe("notSignable");
  });

  it("оператор, документ без подписи и закрытая версия — без кнопок подписи", () => {
    expect(signStep({ ...doc, myParty: null })).toBe("operator");
    expect(signStep({ ...doc, signable: false })).toBe("notRequired");
    expect(signStep({ ...doc, status: "SIGNED" })).toBe("closed");
    expect(signStep({ ...doc, status: "SUPERSEDED" })).toBe("closed");
  });
});

describe("focusTargetAfter — куда перевести фокус после смены шага", () => {
  it("подпись готова — на сообщение об итоге", () => {
    expect(focusTargetAfter("completing", "done")).toBe("result");
  });

  it("вернулись к выбору из ожидания или проверки — на выбранный способ", () => {
    expect(focusTargetAfter("awaiting", "choose")).toBe("method");
    expect(focusTargetAfter("completing", "choose")).toBe("method");
  });

  it("шаг не сменился или сменился без исчезнувшей кнопки — фокус не трогаем", () => {
    expect(focusTargetAfter("done", "done")).toBeNull();
    expect(focusTargetAfter("choose", "choose")).toBeNull();
    expect(focusTargetAfter("starting", "choose")).toBeNull();
    expect(focusTargetAfter("choose", "starting")).toBeNull();
    expect(focusTargetAfter("starting", "awaiting")).toBeNull();
  });
});

