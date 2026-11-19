import { beforeEach, describe, expect, it, vi } from "vitest";
import { consentDocument, consentTextSha256 } from "@/modules/identity";
import type { CurrentUser } from "@/modules/identity";

const h = vi.hoisted(() => ({
  user: null as unknown,
  chosen: null as "CLIENT" | "EXECUTOR" | null,
}));

vi.mock("@/modules/identity", async (original) => ({
  ...(await original<typeof import("@/modules/identity")>()),
  getCurrentUser: async () => h.user,
}));
vi.mock("./role-cookie", () => ({ recallRole: async () => h.chosen }));

const { requireAdmin, requireV2User } = await import("./auth");

const CURRENT = { id: "c1", version: consentDocument("PD_PROCESSING").version, textSha256: consentTextSha256("PD_PROCESSING") };

/** Заказчик, прошедший все первые шаги; поля переопределяет тест. */
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

/** Куда ушла страница: адрес redirect() (Next бросает ошибку с digest) или `null`, если страница открылась. */
async function target(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    const digest = (e as { digest?: string }).digest ?? "";
    if (!digest.startsWith("NEXT_REDIRECT")) throw e;
    return digest.split(";")[2] ?? null;
  }
}

const NEXT = "/v2/deals/1";
const Q = `?next=${encodeURIComponent(NEXT)}`;

beforeEach(() => {
  h.user = person();
  h.chosen = null;
});

describe("requireV2User: гость и обычная страница", () => {
  it("без сессии — вход v2 с возвратом на страницу", async () => {
    h.user = null;
    expect(await target(requireV2User(NEXT))).toBe(`/v2/login${Q}`);
  });

  it("без сессии на самой странице входа возврата нет (петля)", async () => {
    h.user = null;
    expect(await target(requireV2User("/v2/login"))).toBe("/v2/login");
  });

  it("все шаги пройдены — страница открывается", async () => {
    expect((await requireV2User(NEXT)).id).toBe("u1");
  });

  it.each([
    ["согласия нет", { consents: [] }, "/v2/consent"],
    ["нет ФИО", { fullName: null }, "/v2/welcome"],
    ["почта не подтверждена", { emailVerified: false }, "/v2/email"],
  ])("не пройден шаг (%s) — на него, с возвратом на страницу", async (_name, over, step) => {
    h.user = person(over);
    expect(await target(requireV2User(NEXT))).toBe(`${step}${Q}`);
  });

  it("первым ведёт согласие, даже если не хватает и ФИО, и почты", async () => {
    h.user = person({ consents: [], fullName: null, iinLast4: null, emailVerified: false });
    expect(await target(requireV2User(NEXT))).toBe(`/v2/consent${Q}`);
  });
});

describe("requireV2User: страница шага не уводит сама на себя (нет петли)", () => {
  it("согласие не пройдено, страница согласия открывается", async () => {
    h.user = person({ consents: [], fullName: null, emailVerified: false });
    expect((await requireV2User(`/v2/consent${Q}`)).id).toBe("u1");
    expect((await requireV2User("/v2/consent")).id).toBe("u1");
  });

  it("знакомство не пройдено, страница знакомства открывается", async () => {
    h.user = person({ fullName: null, iinLast4: null, emailVerified: false });
    expect((await requireV2User(`/v2/welcome${Q}`)).id).toBe("u1");
  });

  it("почта не подтверждена, страница почты открывается", async () => {
    h.user = person({ emailVerified: false });
    expect((await requireV2User(`/v2/email${Q}`)).id).toBe("u1");
  });

  it("страница знакомства без согласия ведёт на согласие, и возврат — не на неё, а туда, куда шли", async () => {
    h.user = person({ consents: [], fullName: null });
    expect(await target(requireV2User(`/v2/welcome${Q}`))).toBe(`/v2/consent${Q}`);
  });

  it("страница согласия у человека с пройденным согласием, но без ФИО, ведёт на знакомство", async () => {
    h.user = person({ fullName: null });
    expect(await target(requireV2User(`/v2/consent${Q}`))).toBe(`/v2/welcome${Q}`);
  });

  it("гость на странице шага — вход с возвратом туда, куда шёл, а не на сам шаг", async () => {
    h.user = null;
    expect(await target(requireV2User(`/v2/consent${Q}`))).toBe(`/v2/login${Q}`);
    expect(await target(requireV2User("/v2/welcome"))).toBe("/v2/login");
  });

  it("чужой next страницы шага отбрасывается", async () => {
    h.user = null;
    expect(await target(requireV2User(`/v2/consent?next=${encodeURIComponent("https://evil.example/x")}`))).toBe("/v2/login");
  });
});

describe("requireV2User: роль", () => {
  it("роль выдана, но не активна — переключение роли (v1) с возвратом", async () => {
    h.user = person({ role: "CLIENT", roles: ["CLIENT", "EXECUTOR"] });
    expect(await target(requireV2User(NEXT, "EXECUTOR"))).toBe(`/v2/switch-role?to=EXECUTOR&returnTo=${encodeURIComponent(NEXT)}`);
  });

  it("нужна роль, которой нет, — дом человека (не вход и не сама страница)", async () => {
    h.user = person({ role: "CLIENT", roles: ["CLIENT"] });
    expect(await target(requireV2User("/v2/executor/requests", "EXECUTOR"))).toBe("/v2");
  });

  it("дом заказчика, выбравшего «Я мастер», — регистрация мастера; она берёт обе роли и не уходит сама в себя", async () => {
    h.chosen = "EXECUTOR";
    h.user = person();
    expect(await target(requireV2User("/v2/executor/requests", "EXECUTOR"))).toBe("/v2/register/executor");
    // Страница регистрации мастера: роли CLIENT и EXECUTOR допустимы — петли нет.
    expect((await requireV2User("/v2/register/executor", "CLIENT", "EXECUTOR")).id).toBe("u1");
  });

  it("дом не требует роль, которой нет: для каждой роли человек, получив отказ, попадает на страницу, где отказа уже нет", async () => {
    for (const role of ["CLIENT", "EXECUTOR", "OPERATOR", "MEASURER", "ADMIN"] as const) {
      h.user = person({
        role,
        roles: [role],
        executor: role === "EXECUTOR" ? { id: "e1", publicNumber: 1, status: "APPROVED" } : null,
        mfa: { required: role === "OPERATOR" || role === "ADMIN", verifiedAt: new Date("2026-11-13T10:00:00Z") },
      });
      const absent = role === "CLIENT" ? "MEASURER" : "CLIENT";
      const home = await target(requireV2User("/v2/somewhere", absent));
      expect(home).not.toBeNull();
      // Дом — страница тех же ролей: повторный вызов с «домашней» ролью пускает.
      expect((await requireV2User(home!, role)).role).toBe(role);
    }
  });
});

describe("requireAdmin: ворота экранов администратора", () => {
  const ADMIN_PAGE = "/v2/admin/data";
  /** Администратор: сотрудник — согласие, ФИО и почта его не касаются; второй фактор пройден. */
  const admin = (over: Record<string, unknown> = {}) =>
    person({ role: "ADMIN", roles: ["ADMIN"], fullName: null, iinLast4: null, emailVerified: false, consents: [], mfa: { required: true, verifiedAt: new Date() }, ...over });

  it("администратор со вторым фактором — страница открывается", async () => {
    h.user = admin();
    expect((await requireAdmin(ADMIN_PAGE)).role).toBe("ADMIN");
  });

  it("администратор без второго фактора — экран кода из приложения с возвратом на страницу", async () => {
    h.user = admin({ mfa: { required: true, verifiedAt: null } });
    expect(await target(requireAdmin(ADMIN_PAGE))).toBe(`/v2/operator/mfa?next=${encodeURIComponent(ADMIN_PAGE)}`);
  });

  it("оператор (со вторым фактором) — в свой дом, а не в админку; заказчик — тоже в свой", async () => {
    h.user = person({ role: "OPERATOR", roles: ["OPERATOR"], consents: [], mfa: { required: true, verifiedAt: new Date() } });
    expect(await target(requireAdmin(ADMIN_PAGE))).toBe("/v2/operator");
    h.user = person();
    expect(await target(requireAdmin(ADMIN_PAGE))).toBe("/v2");
  });

  it("гость — на вход с возвратом на страницу админки", async () => {
    h.user = null;
    expect(await target(requireAdmin(ADMIN_PAGE))).toBe(`/v2/login?next=${encodeURIComponent(ADMIN_PAGE)}`);
  });
});
