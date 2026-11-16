import { describe, expect, it } from "vitest";
import { initialSigningState, signingReducer } from "@/features/signing/state";
import { ru } from "@/i18n/ru";
import type { ActionResult } from "@/platform/action";
import { attempt, type Handled } from "./sign-call";

const handle = <T>(result: ActionResult<T>): Handled<T> =>
  result.ok ? { kind: "ok", data: result.data } : { kind: "error", error: result.error };
const offline = () => Promise.reject(new TypeError("Failed to fetch"));
const signed = () => Promise.resolve<ActionResult<{ fullySigned: boolean }>>({ ok: true, data: { fullySigned: false } });

describe("attempt: вызов действия подписи при обрыве сети", () => {
  it("отклонённый промис без сети — отказ с текстом «Нет связи», кнопка снова свободна, повтор уходит на сервер", async () => {
    const gate = { current: false };
    const out = await attempt(gate, offline, handle, false);
    expect(out).toEqual({ kind: "error", error: ru.app.kit.network.offline });
    expect(gate.current).toBe(false);
    // Повтор той же подписи: сервер отвечает тем же успехом (actions.ts, repeated) — второй подписи нет.
    expect(await attempt(gate, signed, handle)).toEqual({ kind: "ok", data: { fullySigned: false } });
  });

  it("сеть есть, а ответа нет (сбой сервера) — «Не удалось отправить»", async () => {
    const out = await attempt({ current: false }, () => Promise.reject(new Error("502")), handle, true);
    expect(out).toEqual({ kind: "error", error: ru.app.kit.network.failed });
  });

  it("пока идёт вызов, второе нажатие не уходит; успех оставляет кнопку занятой (до смены шага)", async () => {
    const gate = { current: false };
    let calls = 0;
    let finish: (r: ActionResult<{ fullySigned: boolean }>) => void = () => {};
    const slow = () => {
      calls += 1;
      return new Promise<ActionResult<{ fullySigned: boolean }>>((resolve) => (finish = resolve));
    };
    const first = attempt(gate, slow, handle);
    expect(await attempt(gate, slow, handle)).toBeNull();
    finish({ ok: true, data: { fullySigned: true } });
    expect(await first).toEqual({ kind: "ok", data: { fullySigned: true } });
    expect(calls).toBe(1);
    expect(gate.current).toBe(true);
  });

  it("отказ сервера — его текст, кнопка свободна; redirect() в действии — уход, кнопка занята", async () => {
    const gate = { current: false };
    const refused = await attempt(gate, () => Promise.resolve<ActionResult<never>>({ ok: false, code: "CONFLICT", error: "Уже изменилось" }), handle);
    expect(refused).toEqual({ kind: "error", error: "Уже изменилось" });
    expect(gate.current).toBe(false);
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;push;/v2/login;307;" });
    expect(await attempt(gate, () => Promise.reject(redirect), handle)).toEqual({ kind: "leaving" });
    expect(gate.current).toBe(true);
  });

  it("ЭЦП: сбой начала возвращает к выбору способа с текстом, сбой проверки — к ожиданию в той же сессии", async () => {
    const out = await attempt({ current: false }, offline, handle, false);
    const error = out?.kind === "error" ? out.error : "";
    const starting = signingReducer(initialSigningState, { type: "start" });
    expect(signingReducer(starting, { type: "failed", error })).toEqual({ step: "choose", method: "EGOV_QR", error });
    const session = { sessionId: "s1", method: "EGOV_QR" as const, expiresAt: new Date("2026-11-16T10:00:00Z"), provider: "mock" as const };
    const completing = signingReducer(signingReducer(starting, { type: "started", session }), { type: "complete" });
    expect(signingReducer(completing, { type: "failed", error })).toEqual({ step: "awaiting", method: "EGOV_QR", session, error });
  });
});
