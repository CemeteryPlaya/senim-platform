import { beforeEach, describe, expect, it, vi } from "vitest";
import { consentDocument, consentTextSha256 } from "@/modules/identity";
import type { CurrentUser } from "@/modules/identity";
import { AppError } from "@/platform/errors";

const h = vi.hoisted(() => ({
  user: null as unknown,
  view: null as unknown,
  viewError: null as unknown,
  party: null as "CLIENT" | "EXECUTOR" | null,
  partyCalls: 0,
}));

vi.mock("@/modules/identity", async (original) => ({
  ...(await original<typeof import("@/modules/identity")>()),
  getCurrentUser: async () => h.user,
}));
vi.mock("./role-cookie", () => ({ recallRole: async () => null }));
vi.mock("@/modules/deal-core", () => ({
  getDealView: async () => {
    if (h.viewError) throw h.viewError;
    return h.view;
  },
  dealPartyOf: async () => {
    h.partyCalls += 1;
    return h.party;
  },
}));

const { requireBuyer, dealOrSwitch } = await import("./auth");

const CURRENT = { id: "c1", version: consentDocument("PD_PROCESSING").version, textSha256: consentTextSha256("PD_PROCESSING") };

function person(over: Record<string, unknown> = {}): CurrentUser {
  return {
    id: "u1",
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
  } as unknown as CurrentUser;
}

/** Результат вызова страницы: адрес redirect(), `NOT_FOUND` для notFound() или `null` — страница открылась. */
async function outcome(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    const digest = (e as { digest?: string }).digest ?? "";
    if (digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2] ?? null;
    if (digest.startsWith("NEXT_HTTP_ERROR_FALLBACK;404")) return "NOT_FOUND";
    throw e;
  }
}

const notFoundError = () => new AppError("NOT_FOUND", "нет такой сделки");

beforeEach(() => {
  h.user = person();
  h.view = { id: "d1", number: 7 };
  h.viewError = null;
  h.party = null;
  h.partyCalls = 0;
});

describe("requireBuyer", () => {
  it("заказчик — страница открывается, возвращается пользователь", async () => {
    expect((await requireBuyer("/v2/deals/d1")).id).toBe("u1");
  });

  it("гость — на вход v2 с возвратом на страницу", async () => {
    h.user = null;
    expect(await outcome(requireBuyer("/v2/deals/d1"))).toBe(`/v2/login?next=${encodeURIComponent("/v2/deals/d1")}`);
  });

  it("мастер, у которого есть и роль заказчика, — на переключение роли с возвратом", async () => {
    h.user = person({ role: "EXECUTOR", roles: ["CLIENT", "EXECUTOR"], executor: { status: "APPROVED" } });
    const to = await outcome(requireBuyer("/v2/deals/d1"));
    expect(to).toMatch(/^\/switch-role\?/);
    expect(new URLSearchParams(to?.split("?")[1]).get("to")).toBe("CLIENT");
  });

  it("мастер без роли заказчика — в свой дом, без петли", async () => {
    h.user = person({ role: "EXECUTOR", roles: ["EXECUTOR"], executor: { status: "APPROVED" } });
    expect(await outcome(requireBuyer("/v2/deals/d1"))).toBe("/v2/executor/requests");
  });

  it("не пройден шаг — на шаг с возвратом", async () => {
    h.user = person({ consents: [] });
    expect(await outcome(requireBuyer("/v2/deals/d1"))).toBe(`/v2/consent?next=${encodeURIComponent("/v2/deals/d1")}`);
  });
});

describe("dealOrSwitch", () => {
  it("своя сделка — вид сделки из модуля", async () => {
    expect(await dealOrSwitch(person(), "d1")).toEqual({ id: "d1", number: 7 });
    expect(h.partyCalls).toBe(0);
  });

  it("чужая сделка (NOT_FOUND, стороной не является) — 404", async () => {
    h.viewError = notFoundError();
    expect(await outcome(dealOrSwitch(person(), "d1"))).toBe("NOT_FOUND");
    h.viewError = notFoundError();
    expect(await outcome(dealOrSwitch(person({ roles: ["CLIENT", "EXECUTOR"] }), "d1"))).toBe("NOT_FOUND");
  });

  it("сторона сделки в другой своей роли — на переключение роли с возвратом на сделку v2", async () => {
    h.viewError = notFoundError();
    h.party = "EXECUTOR";
    const to = await outcome(dealOrSwitch(person({ roles: ["CLIENT", "EXECUTOR"] }), "d1"));
    expect(to).toBe(`/v2/switch-role?to=EXECUTOR&returnTo=${encodeURIComponent("/v2/deals/d1")}`);
  });

  it("сторона в роли, которой у человека нет в выданных, — 404, а не переключение", async () => {
    h.viewError = notFoundError();
    h.party = "EXECUTOR";
    expect(await outcome(dealOrSwitch(person({ roles: ["CLIENT", "MEASURER"] }), "d1"))).toBe("NOT_FOUND");
  });

  it("id сделки в возврате экранируется", async () => {
    h.viewError = notFoundError();
    h.party = "EXECUTOR";
    const to = await outcome(dealOrSwitch(person({ roles: ["CLIENT", "EXECUTOR"] }), "a/b?c"));
    expect(new URLSearchParams(to?.split("?")[1]).get("returnTo")).toBe("/v2/deals/a%2Fb%3Fc");
  });

  it("другие ошибки модуля не маскируются под 404", async () => {
    h.viewError = new AppError("FORBIDDEN", "нельзя");
    await expect(dealOrSwitch(person(), "d1")).rejects.toMatchObject({ code: "FORBIDDEN" });
    h.viewError = new Error("база недоступна");
    await expect(dealOrSwitch(person(), "d1")).rejects.toThrow("база недоступна");
  });
});
