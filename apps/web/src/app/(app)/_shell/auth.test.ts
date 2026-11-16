import { describe, expect, it } from "vitest";
import { consentDocument, consentTextSha256 } from "@/modules/identity";
import { homeAfterSwitch, homeFor, makeSafeNext, masterStatusOf, nextStepFor, safeNext, type StepUser } from "./auth";

const CURRENT = { id: "c1", version: consentDocument("PD_PROCESSING").version, textSha256: consentTextSha256("PD_PROCESSING") };

/** Заказчик, прошедший все первые шаги; поля переопределяет тест. */
function client(over: Partial<StepUser> = {}): StepUser {
  return {
    role: "CLIENT",
    roles: ["CLIENT"],
    executor: null,
    fullName: "Сапаров Ерлан",
    iinLast4: "1234",
    emailVerified: true,
    mfa: { required: false, verifiedAt: null },
    consents: [CURRENT],
    consentRevocationOpen: false,
    ...over,
  };
}

/** Оператор: согласия, ФИО и почты нет — его эти шаги не касаются; второй фактор пройден. */
function operator(over: Partial<StepUser> = {}): StepUser {
  return client({
    role: "OPERATOR",
    roles: ["OPERATOR"],
    fullName: null,
    iinLast4: null,
    emailVerified: false,
    consents: [],
    mfa: { required: true, verifiedAt: new Date("2026-11-13T10:00:00Z") },
    ...over,
  });
}

const NEXT = "/v2/deals/1";
const Q = `?next=${encodeURIComponent(NEXT)}`;

describe("safeNext", () => {
  it.each([
    ["/v2/deals/1", "/v2/deals/1"],
    ["/v2", "/v2"],
    ["/v2?tab=money", "/v2?tab=money"],
    ["/v2/deals/1#chat", "/v2/deals/1#chat"],
    ["/deals/1", null],
    ["//evil.com", null],
    ["/\\evil.com", null],
    ["/%5Cevil.com", null],
    ["/\t/evil.com", null],
    ["https://evil.com", null],
    ["javascript:alert(1)", null],
    ["", null],
    [undefined, null],
    ["/v2x/deals", null],
    ["/v2/../deals/1", null],
    ["/v2/login", null],
    ["/v2/login?step=code", null],
    ["/api/files/1", null],
  ])("%j → %j", (raw, expected) => {
    expect(safeNext(raw)).toBe(expected);
  });

  it("при пустом префиксе (после переключения) — любой путь сайта, кроме входа и API", () => {
    const atRoot = makeSafeNext("");
    expect(atRoot("/deals/1")).toBe("/deals/1");
    expect(atRoot("/")).toBe("/");
    expect(atRoot("/login")).toBeNull();
    expect(atRoot("/login?next=%2F")).toBeNull();
    expect(atRoot("/api/push")).toBeNull();
    expect(atRoot("//evil.com")).toBeNull();
    expect(atRoot("https://evil.com/x")).toBeNull();
  });
});

describe("nextStepFor", () => {
  it.each<[string, StepUser, string | null, "CLIENT" | "EXECUTOR" | null, string]>([
    ["без согласия — согласие с возвратом", client({ consents: [] }), NEXT, null, `/v2/consent${Q}`],
    ["без согласия и без next — согласие без параметра", client({ consents: [] }), null, null, "/v2/consent"],
    ["согласие прежней редакции — снова согласие", client({ consents: [{ ...CURRENT, version: "2020-01-01" }] }), NEXT, null, `/v2/consent${Q}`],
    ["без согласия и без ФИО — сначала согласие", client({ consents: [], fullName: null }), NEXT, null, `/v2/consent${Q}`],
    ["без ФИО — знакомство", client({ fullName: null }), NEXT, null, `/v2/welcome${Q}`],
    ["без ИИН — знакомство", client({ iinLast4: null }), null, null, "/v2/welcome"],
    ["почта не подтверждена — почта", client({ emailVerified: false }), NEXT, null, `/v2/email${Q}`],
    ["всё пройдено и next — next", client(), NEXT, null, NEXT],
    ["всё пройдено, без next — главная заказчика", client(), null, null, "/v2"],
    ["выбрал «Заказать мебель» — главная", client(), null, "CLIENT", "/v2"],
    ["заказчик без профиля мастера выбрал «Я мастер» — регистрация мастера", client(), null, "EXECUTOR", "/v2/register/executor"],
    ["выбрал «Я мастер», но есть next — next", client(), NEXT, "EXECUTOR", NEXT],
    ["выбрал «Я мастер», но нет согласия — согласие", client({ consents: [] }), null, "EXECUTOR", "/v2/consent"],
    [
      "мастер с одобренным профилем — главная мастера",
      client({ role: "EXECUTOR", roles: ["EXECUTOR"], executor: { id: "e1", publicNumber: 1, status: "APPROVED" } }),
      null,
      null,
      "/v2",
    ],
    [
      "мастер с профилем на проверке — регистрация мастера",
      client({ role: "EXECUTOR", roles: ["EXECUTOR"], executor: { id: "e1", publicNumber: 1, status: "PENDING" } }),
      null,
      "EXECUTOR",
      "/v2/register/executor",
    ],
    ["оператор — его раздел; согласие, ФИО и почта его не касаются", operator(), null, null, "/v2/operator"],
    ["оператор с next — next", operator(), NEXT, null, NEXT],
    [
      "оператор без второго фактора — экран кода из приложения v2 с возвратом домой",
      operator({ mfa: { required: true, verifiedAt: null } }),
      null,
      null,
      `/v2/operator/mfa?next=${encodeURIComponent("/v2/operator")}`,
    ],
    [
      "оператор без второго фактора с next — экран кода с возвратом на next",
      operator({ mfa: { required: true, verifiedAt: null } }),
      "/v2/operator/money",
      null,
      `/v2/operator/mfa?next=${encodeURIComponent("/v2/operator/money")}`,
    ],
  ])("%s", (_name, user, next, chosen, expected) => {
    expect(nextStepFor(user, next, chosen)).toBe(expected);
  });
});

describe("homeFor", () => {
  it("замерщик — замеры", () => {
    expect(homeFor({ role: "MEASURER", executor: null })).toBe("/v2/measurer");
  });

  it("мастер, выбравший «Заказать мебель», всё равно попадает в свой дом", () => {
    expect(homeFor({ role: "EXECUTOR", executor: null }, "CLIENT")).toBe("/v2/register/executor");
  });

  it("заказчик с профилем мастера, выбравший «Я мастер», — главная (профиль уже есть)", () => {
    expect(homeFor({ role: "CLIENT", executor: { id: "e1", publicNumber: 1, status: "PENDING" } }, "EXECUTOR")).toBe("/v2");
  });
});

describe("homeFor мастера", () => {
  const executor = (status: "PENDING" | "APPROVED" | "REJECTED" | null) =>
    ({ role: "EXECUTOR", executor: status === null ? null : { id: "e1", publicNumber: 1, status } }) as const;

  it("одобренный — главная v2 (его «что сейчас»), а не входящие заявки", () => {
    expect(homeFor(executor("APPROVED"))).toBe("/v2");
  });

  it.each(["PENDING", "REJECTED", null] as const)("неодобренный (%s) — регистрация мастера: анкета и статус проверки", (status) => {
    expect(homeFor(executor(status))).toBe("/v2/register/executor");
  });
});

describe("homeAfterSwitch", () => {
  it("дом новой роли v2 — тот же, что после входа: мастер — главная или регистрация мастера, покупатель — главная", () => {
    expect(homeAfterSwitch({ role: "EXECUTOR", executor: { id: "e1", publicNumber: 1, status: "APPROVED" } })).toBe("/v2");
    expect(homeAfterSwitch({ role: "EXECUTOR", executor: { id: "e1", publicNumber: 1, status: "PENDING" } })).toBe("/v2/register/executor");
    expect(homeAfterSwitch({ role: "EXECUTOR", executor: null })).toBe("/v2/register/executor");
    expect(homeAfterSwitch({ role: "CLIENT", executor: null })).toBe("/v2");
  });
});

describe("masterStatusOf", () => {
  it.each([
    [null, "none"],
    ["PENDING", "pending"],
    ["REJECTED", "rejected"],
    ["APPROVED", "approved"],
  ] as const)("%s → %s", (status, expected) => {
    expect(masterStatusOf({ executor: status === null ? null : { id: "e1", publicNumber: 1, status } })).toBe(expected);
  });
});
