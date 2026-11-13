import { beforeEach, describe, expect, it, vi } from "vitest";
import { consentDocument, consentTextSha256 } from "@/modules/identity";

// Вошедший с непройденными первыми шагами не застревает на страницах, открытых гостю: главная, каталог, «О сервисе»,
// профиль мастера уводят его на первый шаг с возвратом туда, где он был. Гость и прошедший шаги — без перехода.

const h = vi.hoisted(() => ({ user: null as unknown, chosen: null as "CLIENT" | "EXECUTOR" | null }));

vi.mock("@/modules/identity", async (original) => ({
  ...(await original<typeof import("@/modules/identity")>()),
  getCurrentUser: async () => h.user,
  getShellUser: async () => ({ user: h.user, unavailable: false }),
}));
vi.mock("../_shell/role-cookie", () => ({ recallRole: async () => h.chosen }));
vi.mock("@/platform/device", () => ({ getDevice: async () => "mobile" }));

const { pageHref, userPastOnboarding } = await import("../_shell/auth");
const { default: V2Home } = await import("./page");
const { default: CatalogPage } = await import("./catalog/page");

const CURRENT = { id: "c1", version: consentDocument("PD_PROCESSING").version, textSha256: consentTextSha256("PD_PROCESSING") };

/** Покупатель, прошедший все первые шаги; поля переопределяет тест. */
function person(over: Record<string, unknown> = {}) {
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
  };
}

async function outcome(p: Promise<unknown>): Promise<{ redirect: string } | { page: unknown }> {
  try {
    return { page: await p };
  } catch (e) {
    const digest = (e as { digest?: string }).digest ?? "";
    if (!digest.startsWith("NEXT_REDIRECT")) throw e;
    return { redirect: digest.split(";")[2] ?? "" };
  }
}

beforeEach(() => {
  h.user = null;
  h.chosen = null;
});

describe("главная /v2", () => {
  it("вошедший без почты — на шаг почты с возвратом на главную", async () => {
    h.user = person({ emailVerified: false });
    expect(await outcome(V2Home())).toEqual({ redirect: `/v2/email?next=${encodeURIComponent("/v2")}` });
  });

  it("вошедший без согласия — сначала согласие", async () => {
    h.user = person({ consents: [], emailVerified: false });
    expect(await outcome(V2Home())).toEqual({ redirect: `/v2/consent?next=${encodeURIComponent("/v2")}` });
  });

  it("гость и прошедший шаги — страница без перехода", async () => {
    expect(await outcome(V2Home())).toHaveProperty("page");
    h.user = person();
    expect(await outcome(V2Home())).toHaveProperty("page");
  });
});

describe("каталог", () => {
  it("вошедший без почты — на шаг почты; next — каталог с теми же фильтрами", async () => {
    h.user = person({ emailVerified: false });
    const res = await outcome(CatalogPage({ searchParams: Promise.resolve({ type: "kitchen", price: "from1500", page: "2" }) }));
    expect(res).toEqual({ redirect: `/v2/email?next=${encodeURIComponent("/v2/catalog?type=kitchen&price=from1500&page=2")}` });
  });
});

describe("userPastOnboarding", () => {
  it("гость — null, прошедший шаги — он сам, без перехода", async () => {
    expect(await userPastOnboarding("/v2/about")).toBeNull();
    h.user = person();
    expect(await userPastOnboarding("/v2/about")).toMatchObject({ id: "u1" });
  });

  it("оператор без почты и согласия не затронут — даже без второго фактора", async () => {
    h.user = person({ role: "OPERATOR", roles: ["OPERATOR"], emailVerified: false, consents: [], mfa: { required: true, verifiedAt: null } });
    expect(await userPastOnboarding("/v2/about")).toMatchObject({ role: "OPERATOR" });
  });

  it("непройденный шаг — переход с возвратом; чужой адрес возврата отбрасывается", async () => {
    h.user = person({ fullName: null, iinLast4: null, emailVerified: false });
    expect(await outcome(userPastOnboarding("/v2/executors/1042"))).toEqual({
      redirect: `/v2/welcome?next=${encodeURIComponent("/v2/executors/1042")}`,
    });
    expect(await outcome(userPastOnboarding("//evil.example/x"))).toEqual({ redirect: "/v2/welcome" });
  });
});

describe("pageHref", () => {
  it("параметры по порядку, повторяющиеся — каждым значением; без параметров — путь", () => {
    expect(pageHref("/catalog", { type: "kitchen", tag: ["a", "b"], empty: undefined })).toBe("/v2/catalog?type=kitchen&tag=a&tag=b");
    expect(pageHref("/catalog")).toBe("/v2/catalog");
  });
});
