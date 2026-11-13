import { describe, expect, it } from "vitest";
import type { ActionResult } from "@/platform/action";
import { formDataToInput, outcomeOf } from "./form";

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
