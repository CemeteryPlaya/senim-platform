import { describe, expect, it, vi } from "vitest";
import type { ActionResult } from "@/platform/action";
import { MFA_CODE_FIELD, runSubmit, type SubmitEnv, type SubmitState, type VerifyCode } from "./form";

/** Состояние формы, как его держит хук: последние значения и просьба кода. */
function state() {
  const s = {
    busy: { current: false },
    pending: false,
    error: null as string | null,
    fieldErrors: {} as Record<string, string>,
    codeReason: null as string | null,
  };
  const set: SubmitState = {
    busy: s.busy,
    setPending: (v) => (s.pending = v),
    setError: (v) => (s.error = v),
    setFieldErrors: (v) => (s.fieldErrors = v),
    setCodeReason: (v) => (s.codeReason = v),
  };
  return { s, set };
}

function environment(): SubmitEnv {
  return { here: () => ({ pathname: "/v2/operator/money", search: "" }), leave: vi.fn<(href: string) => void>(), onPageShow: () => () => undefined };
}

const STEP_UP = "Подтвердите действие кодом из приложения";
const ok = <T>(data: T): ActionResult<T> => ({ ok: true, data });
const mfaRequired: ActionResult<never> = { ok: false, code: "MFA_REQUIRED", error: STEP_UP };

const fields = (entries: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
};

describe("протокол второго фактора в форме v2 (runSubmit с verifyCode)", () => {
  it("действие ответило MFA_REQUIRED — форма просит код (текст сервера), общей ошибки нет, форма свободна", async () => {
    const { s, set } = state();
    const verify = vi.fn<VerifyCode>(async () => ok(undefined));
    await runSubmit(async () => mfaRequired, { verifyCode: verify }, set, environment(), fields({ transactionId: "t1" }));
    expect(s).toMatchObject({ codeReason: STEP_UP, error: null, fieldErrors: {}, pending: false });
    expect(s.busy.current).toBe(false);
    expect(verify).not.toHaveBeenCalled();
  });

  it("с кодом в полях — сначала проверка кода, затем действие без поля кода; поле кода убирается", async () => {
    const { s, set } = state();
    s.codeReason = STEP_UP;
    const order: string[] = [];
    const verify = vi.fn<VerifyCode>(async ({ code }) => {
      order.push(`verify:${code}`);
      return ok(undefined);
    });
    const action = vi.fn(async (input: Record<string, FormDataEntryValue>) => {
      order.push(`action:${Object.keys(input).join(",")}`);
      return ok(1);
    });
    const onSuccess = vi.fn();
    await runSubmit(action, { verifyCode: verify, onSuccess }, set, environment(), fields({ transactionId: "t1", [MFA_CODE_FIELD]: "123 456" }));
    expect(order).toEqual(["verify:123 456", "action:transactionId"]);
    expect(onSuccess).toHaveBeenCalledWith(1);
    expect(s.codeReason).toBeNull();
  });

  it("код не принят — ошибка у поля кода (текст поля code), действие не вызывается, просьба кода остаётся", async () => {
    const { s, set } = state();
    s.codeReason = STEP_UP;
    const wrong: ActionResult<never> = { ok: false, code: "VALIDATION", error: "Неверный код", fieldErrors: { code: ["Неверный код. Осталось попыток: 4"] } };
    const action = vi.fn(async () => ok(1));
    await runSubmit(action, { verifyCode: async () => wrong }, set, environment(), fields({ [MFA_CODE_FIELD]: "000000" }));
    expect(action).not.toHaveBeenCalled();
    expect(s.fieldErrors).toEqual({ [MFA_CODE_FIELD]: "Неверный код. Осталось попыток: 4" });
    expect(s).toMatchObject({ error: null, codeReason: STEP_UP, pending: false });
  });

  it("лимит кодов без ошибки поля — общий текст отказа встаёт у поля кода", async () => {
    const { s, set } = state();
    const limited: ActionResult<never> = { ok: false, code: "RATE_LIMITED", error: "Слишком много неверных кодов" };
    await runSubmit(async () => ok(1), { verifyCode: async () => limited }, set, environment(), fields({ [MFA_CODE_FIELD]: "000000" }));
    expect(s.fieldErrors).toEqual({ [MFA_CODE_FIELD]: "Слишком много неверных кодов" });
  });

  it("сессия истекла при проверке кода — уход на вход с возвратом, действие не вызывается, форма занята", async () => {
    const { s, set } = state();
    const env = environment();
    const action = vi.fn(async () => ok(1));
    const expired: ActionResult<never> = { ok: false, code: "UNAUTHENTICATED", error: "x" };
    vi.useFakeTimers();
    try {
      await runSubmit(action, { verifyCode: async () => expired }, set, env, fields({ [MFA_CODE_FIELD]: "123456" }));
    } finally {
      vi.useRealTimers();
    }
    expect(env.leave).toHaveBeenCalledWith(`/v2/login?next=${encodeURIComponent("/v2/operator/money")}`);
    expect(action).not.toHaveBeenCalled();
    expect(s.busy.current).toBe(true);
  });

  it("код принят, а действие отказало по своей причине — общая ошибка, поле кода убирается", async () => {
    const { s, set } = state();
    s.codeReason = STEP_UP;
    const refused: ActionResult<never> = { ok: false, code: "CONFLICT", error: "Операцию уже подтвердили" };
    await runSubmit(async () => refused, { verifyCode: async () => ok(undefined) }, set, environment(), fields({ [MFA_CODE_FIELD]: "123456" }));
    expect(s).toMatchObject({ error: "Операцию уже подтвердили", codeReason: null });
  });

  it("без verifyCode MFA_REQUIRED — обычная ошибка формы, поле кода в действие уходит как есть", async () => {
    const { s, set } = state();
    const action = vi.fn(async (input: Record<string, FormDataEntryValue>) => {
      expect(input[MFA_CODE_FIELD]).toBe("1");
      return mfaRequired;
    });
    await runSubmit(action, {}, set, environment(), fields({ [MFA_CODE_FIELD]: "1" }));
    expect(s).toMatchObject({ error: STEP_UP, codeReason: null });
  });

  it("исходные поля формы не меняются (код вырезается из копии)", async () => {
    const { set } = state();
    const data = fields({ transactionId: "t1", [MFA_CODE_FIELD]: "123456" });
    await runSubmit(async () => ok(1), { verifyCode: async () => ok(undefined) }, set, environment(), data);
    expect(data.get(MFA_CODE_FIELD)).toBe("123456");
  });
});
