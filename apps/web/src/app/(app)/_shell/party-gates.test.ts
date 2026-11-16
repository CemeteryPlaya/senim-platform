import { beforeEach, describe, expect, it, vi } from "vitest";
import { consentDocument, consentTextSha256 } from "@/modules/identity";
import type { CurrentUser } from "@/modules/identity";
import { AppError } from "@/platform/errors";

const h = vi.hoisted(() => ({
  user: null as unknown,
  chosen: null as "CLIENT" | "EXECUTOR" | null,
  view: null as unknown,
  viewError: null as unknown,
  party: null as "CLIENT" | "EXECUTOR" | null,
  viewCalls: 0,
}));

vi.mock("@/modules/identity", async (original) => ({
  ...(await original<typeof import("@/modules/identity")>()),
  getCurrentUser: async () => h.user,
}));
vi.mock("./role-cookie", () => ({ recallRole: async () => h.chosen }));
vi.mock("@/modules/deal-core", () => ({
  getDealView: async () => {
    h.viewCalls += 1;
    if (h.viewError) throw h.viewError;
    return h.view;
  },
  dealPartyOf: async () => h.party,
}));

const { partyDeal, requireMaster, requireParty, requireV2User, switchRoleTo } = await import("./auth");

const CURRENT = { id: "c1", version: consentDocument("PD_PROCESSING").version, textSha256: consentTextSha256("PD_PROCESSING") };

type Executor = { id: string; publicNumber: number; status: "PENDING" | "APPROVED" | "REJECTED" } | null;
const approved: Executor = { id: "e1", publicNumber: 1, status: "APPROVED" };

/** Человек, прошедший первые шаги; по умолчанию — покупатель. */
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

const master = (executor: Executor = approved, roles = ["EXECUTOR"]) => person({ role: "EXECUTOR", roles, executor });
const operator = () => person({ role: "OPERATOR", roles: ["OPERATOR"], mfa: { required: true, verifiedAt: new Date("2026-11-13T10:00:00Z") } });

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

const HERE = "/v2/chats";
const notFoundError = () => new AppError("NOT_FOUND", "нет такой сделки");

beforeEach(() => {
  h.user = person();
  h.chosen = null;
  h.view = { id: "d1", number: 7, viewer: "CLIENT" };
  h.viewError = null;
  h.party = null;
  h.viewCalls = 0;
});

describe("requireParty: сторона сделки в активной роли", () => {
  it("покупатель — пользователь и сторона CLIENT", async () => {
    const got = await requireParty(HERE);
    expect(got.user.id).toBe("u1");
    expect(got.side).toBe("CLIENT");
  });

  it.each([
    ["одобренный", approved],
    ["на проверке", { id: "e1", publicNumber: 1, status: "PENDING" }],
    ["без профиля", null],
  ] as const)("мастер (%s) — сторона EXECUTOR, без ошибки", async (_name, executor) => {
    h.user = master(executor);
    expect((await requireParty(HERE)).side).toBe("EXECUTOR");
  });

  it("человек с двумя ролями — сторона по активной роли, без переключения", async () => {
    h.user = master(approved, ["CLIENT", "EXECUTOR"]);
    expect((await requireParty(HERE)).side).toBe("EXECUTOR");
    h.user = person({ roles: ["CLIENT", "EXECUTOR"], executor: approved });
    expect((await requireParty(HERE)).side).toBe("CLIENT");
  });

  it("гость — на вход с возвратом; не пройден шаг — на шаг", async () => {
    h.user = null;
    expect(await outcome(requireParty(HERE))).toBe(`/v2/login?next=${encodeURIComponent(HERE)}`);
    h.user = master(approved, ["EXECUTOR"]);
    (h.user as { consents: unknown[] }).consents = [];
    expect(await outcome(requireParty(HERE))).toBe(`/v2/consent?next=${encodeURIComponent(HERE)}`);
  });

  it("оператор и замерщик — в свой дом, не на сторону", async () => {
    h.user = operator();
    expect(await outcome(requireParty(HERE))).toBe("/v2/operator");
    h.user = person({ role: "MEASURER", roles: ["MEASURER"] });
    expect(await outcome(requireParty(HERE))).toBe("/v2/measurer");
  });
});

describe("requireMaster: активная роль мастера и статус профиля", () => {
  const PAGE = "/v2/executor/requests";

  it.each([
    ["APPROVED", "approved"],
    ["PENDING", "pending"],
    ["REJECTED", "rejected"],
  ] as const)("мастер (%s) — открывается, статус %s (неодобренному — экран статуса, не ошибка)", async (status, expected) => {
    h.user = master({ id: "e1", publicNumber: 1, status });
    const got = await requireMaster(PAGE);
    expect(got.user.id).toBe("u1");
    expect(got.status).toBe(expected);
  });

  it("мастер без профиля — статус none, без ошибки", async () => {
    h.user = master(null);
    expect((await requireMaster(PAGE)).status).toBe("none");
  });

  it("покупатель с выданной ролью мастера — переключение роли с возвратом сюда", async () => {
    h.user = person({ roles: ["CLIENT", "EXECUTOR"], executor: approved });
    expect(await outcome(requireMaster(PAGE))).toBe(switchRoleTo("EXECUTOR", PAGE));
  });

  it("покупатель без роли мастера — его дом; выбравший «Я мастер» — регистрация мастера, она берёт обе роли (без петли)", async () => {
    expect(await outcome(requireMaster(PAGE))).toBe("/v2");
    h.chosen = "EXECUTOR";
    expect(await outcome(requireMaster(PAGE))).toBe("/v2/register/executor");
    expect((await requireV2User("/v2/register/executor", "CLIENT", "EXECUTOR")).id).toBe("u1");
  });

  it("гость — на вход с возвратом; оператор — в свой раздел", async () => {
    h.user = null;
    expect(await outcome(requireMaster(PAGE))).toBe(`/v2/login?next=${encodeURIComponent(PAGE)}`);
    h.user = operator();
    expect(await outcome(requireMaster(PAGE))).toBe("/v2/operator");
  });

  it("дом неодобренного мастера не требует одобрения: регистрация пускает мастера в любом статусе", async () => {
    for (const status of ["PENDING", "REJECTED"] as const) {
      h.user = master({ id: "e1", publicNumber: 1, status });
      expect((await requireV2User("/v2/register/executor", "CLIENT", "EXECUTOR")).id).toBe("u1");
    }
  });
});

describe("partyDeal: сделка для стороны в её активной роли", () => {
  it("покупатель своей сделки — вид сделки и сторона CLIENT", async () => {
    expect(await partyDeal(person(), "d1")).toEqual({ deal: h.view, side: "CLIENT" });
  });

  it("мастер своей сделки — сторона EXECUTOR", async () => {
    h.view = { id: "d1", number: 7, viewer: "EXECUTOR" };
    expect((await partyDeal(master(), "d1")).side).toBe("EXECUTOR");
  });

  it("неодобренный мастер своей сделки — тоже открывается: права решает модуль", async () => {
    h.view = { id: "d1", number: 7, viewer: "EXECUTOR" };
    expect((await partyDeal(master({ id: "e1", publicNumber: 1, status: "PENDING" }), "d1")).side).toBe("EXECUTOR");
  });

  it("человек — мастер этой сделки, а активен как покупатель: переключение на мастера с возвратом на сделку v2", async () => {
    h.viewError = notFoundError();
    h.party = "EXECUTOR";
    expect(await outcome(partyDeal(person({ roles: ["CLIENT", "EXECUTOR"], executor: approved }), "d1"))).toBe(switchRoleTo("EXECUTOR", "/v2/deals/d1"));
  });

  it("адрес возврата `here`: после переключения роли — на исходный экран (подпись, спор, история денег)", async () => {
    const both = person({ roles: ["CLIENT", "EXECUTOR"], executor: approved });
    h.party = "EXECUTOR";
    for (const here of ["/v2/deals/d1/sign/c1", "/v2/deals/d1/dispute", "/v2/deals/d1/money?x=1"]) {
      h.viewError = notFoundError();
      expect(await outcome(partyDeal(both, "d1", { here }))).toBe(switchRoleTo("EXECUTOR", here));
    }
  });

  it("чужой и не-v2 адрес возврата отбрасывается — возврат на карточку сделки", async () => {
    const both = person({ roles: ["CLIENT", "EXECUTOR"], executor: approved });
    h.party = "EXECUTOR";
    for (const here of ["//evil.example/x", "https://evil.example/v2", "/deals/d1/money", "/v2/../admin", "/v2/login", ""]) {
      h.viewError = notFoundError();
      expect(await outcome(partyDeal(both, "d1", { here })), here).toBe(switchRoleTo("EXECUTOR", "/v2/deals/d1"));
    }
  });

  it("с `here` своя сделка открывается как обычно, чужая — 404", async () => {
    expect((await partyDeal(person(), "d1", { here: "/v2/deals/d1/money" })).side).toBe("CLIENT");
    h.viewError = notFoundError();
    expect(await outcome(partyDeal(person(), "d1", { here: "/v2/deals/d1/money" }))).toBe("NOT_FOUND");
  });

  it("человек — покупатель этой сделки, а активен как мастер: переключение на покупателя", async () => {
    h.viewError = notFoundError();
    h.party = "CLIENT";
    expect(await outcome(partyDeal(master(approved, ["CLIENT", "EXECUTOR"]), "d1"))).toBe(switchRoleTo("CLIENT", "/v2/deals/d1"));
  });

  it("чужая и несуществующая сделка — 404 (у мастера и у покупателя), без переключения", async () => {
    h.viewError = notFoundError();
    expect(await outcome(partyDeal(master(approved, ["CLIENT", "EXECUTOR"]), "d1"))).toBe("NOT_FOUND");
    h.viewError = notFoundError();
    expect(await outcome(partyDeal(person(), "d1"))).toBe("NOT_FOUND");
  });

  it("оператор — на свою карточку сделки v2 (или на указанный адрес), модуль не читается", async () => {
    expect(await outcome(partyDeal(operator(), "d1"))).toBe("/v2/operator/deals/d1");
    expect(await outcome(partyDeal(operator(), "a/b"))).toBe("/v2/operator/deals/a%2Fb");
    expect(await outcome(partyDeal(operator(), "d1", { operatorTo: "/deals/d1/money" }))).toBe("/deals/d1/money");
    expect(await outcome(partyDeal(operator(), "d1", { operatorTo: "//evil.example" }))).toBe("/");
    expect(h.viewCalls).toBe(0);
  });

  it("другие ошибки модуля не маскируются под 404", async () => {
    h.viewError = new AppError("FORBIDDEN", "нельзя");
    await expect(partyDeal(person(), "d1")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
