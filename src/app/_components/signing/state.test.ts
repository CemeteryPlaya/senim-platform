import { describe, expect, it } from "vitest";
import { initialSigningState, focusTargetAfter, signNotice, signingReducer, type SigningSessionView } from "./state";

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

  it("действия не по порядку игнорируются (двойное нажатие)", () => {
    const starting = signingReducer(initialSigningState, { type: "start" });
    expect(signingReducer(starting, { type: "start" })).toBe(starting);
    expect(signingReducer(initialSigningState, { type: "complete" })).toBe(initialSigningState);
  });
});

describe("signNotice — что показать вместо «Подписать»", () => {
  const signed = { party: "CLIENT" as const, signedAt: new Date(0), signedSha256: "a", method: "EGOV_QR" as const };
  const doc = { status: "SIGNING" as const, myParty: "CLIENT" as const, canSign: false, signatures: [] as (typeof signed)[] };

  it("моя подпись есть — «Вы подписали»", () => {
    expect(signNotice({ ...doc, signatures: [signed] })).toBe("youSigned");
  });

  it("не подписывал, но шаг сделки подпись не принимает (расторгнута, отменена) — не «Вы подписали»", () => {
    expect(signNotice(doc)).toBe("notSignable");
    expect(signNotice({ ...doc, signatures: [{ ...signed, party: "EXECUTOR" }] })).toBe("notSignable");
  });

  it("подписать можно или документ уже не на подписи — без пометки", () => {
    expect(signNotice({ ...doc, canSign: true })).toBeNull();
    expect(signNotice({ ...doc, status: "SIGNED", signatures: [signed] })).toBeNull();
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

