import { redirect } from "next/navigation";
import { describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import type { ActionResult } from "@/platform/action";
import { formDataToInput, outcomeOf, runSubmit, submitterOf, type SubmitState } from "./form";

const here = { pathname: "/v2/masters/7", search: "?tab=works" };

describe("outcomeOf: ответ действия → состояние формы", () => {
  it("успех отдаёт данные", () => {
    const result: ActionResult<{ id: string }> = { ok: true, data: { id: "1" } };
    expect(outcomeOf(result, here)).toEqual({ kind: "success", data: { id: "1" } });
  });

  it("UNAUTHENTICATED уводит на вход v2 с возвратом на этот экран", () => {
    const result: ActionResult<never> = { ok: false, code: "UNAUTHENTICATED", error: "Войдите" };
    expect(outcomeOf(result, here)).toEqual({
      kind: "leave",
      href: `/v2/login?next=${encodeURIComponent("/v2/masters/7?tab=works")}`,
    });
  });

  it("CONSENT_REQUIRED уводит на экран согласия v2 с тем же возвратом", () => {
    const result: ActionResult<never> = { ok: false, code: "CONSENT_REQUIRED", error: "Нужно согласие" };
    expect(outcomeOf(result, here)).toEqual({
      kind: "leave",
      href: `/v2/consent?next=${encodeURIComponent("/v2/masters/7?tab=works")}`,
    });
  });

  it("адреса — под префиксом v2, а не v1", () => {
    const result: ActionResult<never> = { ok: false, code: "UNAUTHENTICATED", error: "x" };
    const out = outcomeOf(result, here);
    expect(out.kind === "leave" && out.href.startsWith("/v2/login")).toBe(true);
  });

  it("уже на экране входа: next не добавляется (нет петли)", () => {
    const result: ActionResult<never> = { ok: false, code: "UNAUTHENTICATED", error: "x" };
    expect(outcomeOf(result, { pathname: "/v2/login", search: "?next=%2Fv2%2Fdeals" })).toEqual({ kind: "leave", href: "/v2/login" });
  });

  it("возврат с чужим адресом отбрасывается (без next)", () => {
    const result: ActionResult<never> = { ok: false, code: "UNAUTHENTICATED", error: "x" };
    expect(outcomeOf(result, { pathname: "//evil.example", search: "" })).toEqual({ kind: "leave", href: "/v2/login" });
  });

  it("прочие ошибки остаются на экране: текст и первое сообщение по каждому полю", () => {
    const result: ActionResult<never> = {
      ok: false,
      code: "VALIDATION",
      error: "Проверьте поля",
      fieldErrors: { phone: ["Неверный номер", "Второе"], code: [] },
    };
    expect(outcomeOf(result, here)).toEqual({
      kind: "error",
      error: "Проверьте поля",
      fieldErrors: { phone: "Неверный номер" },
    });
  });

  it("без fieldErrors — пустой объект", () => {
    const result: ActionResult<never> = { ok: false, code: "INTERNAL", error: "Сбой" };
    expect(outcomeOf(result, here)).toEqual({ kind: "error", error: "Сбой", fieldErrors: {} });
  });
});

describe("formDataToInput", () => {
  it("поля формы → простой объект", () => {
    const data = new FormData();
    data.set("phone", "+77001234567");
    data.set("next", "/v2");
    expect(formDataToInput(data)).toEqual({ phone: "+77001234567", next: "/v2" });
  });
});

describe("submitterOf: кнопка, которой отправили форму", () => {
  it("button и input — отправитель", () => {
    const button = { tagName: "BUTTON", name: "intent", value: "again" };
    expect(submitterOf({ submitter: button })).toBe(button);
    const input = { tagName: "input" };
    expect(submitterOf({ submitter: input })).toBe(input);
  });

  it("нет отправителя (Enter в поле без кнопки, старый браузер) или чужой элемент — null", () => {
    expect(submitterOf({ submitter: null })).toBeNull();
    expect(submitterOf({})).toBeNull();
    expect(submitterOf(null)).toBeNull();
    expect(submitterOf({ submitter: { tagName: "DIV" } })).toBeNull();
    expect(submitterOf({ submitter: "button" })).toBeNull();
  });
});

describe("runSubmit: отправка формы useActionForm", () => {
  /** Состояние формы, как его держит хук: занятость (ref) и последние значения pending / error / fieldErrors. */
  function state() {
    const s = { busy: { current: false }, pending: false, error: null as string | null, fieldErrors: {} as Record<string, string> };
    const set: SubmitState = {
      busy: s.busy,
      setPending: (v) => (s.pending = v),
      setError: (v) => (s.error = v),
      setFieldErrors: (v) => (s.fieldErrors = v),
    };
    return { s, set };
  }
  const env = { here: () => here, leave: vi.fn<(href: string) => void>() };

  it("действие сделало redirect(): ошибки нет, форма остаётся занятой, повтор не вызывает действие", async () => {
    const { s, set } = state();
    const action = vi.fn(async (): Promise<ActionResult<never>> => redirect("/v2/consent"));
    await runSubmit(action, {}, set, env, new FormData());
    expect(s.error).toBeNull();
    expect(s.pending).toBe(true);
    expect(s.busy.current).toBe(true);
    await runSubmit(action, {}, set, env, new FormData());
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("сбой транспорта: общий текст и форма снова свободна", async () => {
    const { s, set } = state();
    const action = vi.fn(async (): Promise<ActionResult<never>> => {
      throw new Error("network");
    });
    await runSubmit(action, {}, set, env, new FormData());
    expect(s.error).toBe(ru.common.errors.generic);
    expect(s.pending).toBe(false);
    expect(s.busy.current).toBe(false);
  });

  it("ошибка у поля: текст и поле, форма свободна", async () => {
    const { s, set } = state();
    const action = vi.fn(async (): Promise<ActionResult<never>> => ({ ok: false, code: "VALIDATION", error: "e", fieldErrors: { code: ["x"] } }));
    await runSubmit(action, {}, set, env, new FormData());
    expect(s).toMatchObject({ error: "e", fieldErrors: { code: "x" }, pending: false });
    expect(s.busy.current).toBe(false);
  });

  it("успех: onSuccess с данными, форма свободна", async () => {
    const { s, set } = state();
    const onSuccess = vi.fn();
    await runSubmit(async () => ({ ok: true, data: 7 }), { onSuccess }, set, env, new FormData());
    expect(onSuccess).toHaveBeenCalledWith(7);
    expect(s.pending).toBe(false);
  });
});
