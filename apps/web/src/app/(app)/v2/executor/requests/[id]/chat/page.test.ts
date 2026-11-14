import { beforeEach, describe, expect, it, vi } from "vitest";
import { consentDocument, consentTextSha256, type CurrentUser } from "@/modules/identity";
import { AppError } from "@/platform/errors";

const h = vi.hoisted(() => ({
  user: null as unknown,
  request: null as unknown,
  error: null as unknown,
  asked: [] as string[],
}));

vi.mock("@/modules/identity", async (original) => ({
  ...(await original<typeof import("@/modules/identity")>()),
  getCurrentUser: async () => h.user,
}));
vi.mock("../../../../../_shell/role-cookie", () => ({ recallRole: async () => null }));
vi.mock("@/modules/requests", () => ({
  getIncomingRequest: async (_user: unknown, id: string) => {
    h.asked.push(id);
    if (h.error) throw h.error;
    return h.request;
  },
}));

const { default: MasterRequestChat } = await import("./page");

const CURRENT = { id: "c1", version: consentDocument("PD_PROCESSING").version, textSha256: consentTextSha256("PD_PROCESSING") };

function person(over: Record<string, unknown> = {}): CurrentUser {
  return {
    id: "u1",
    role: "EXECUTOR",
    roles: ["EXECUTOR"],
    executor: { id: "e1", publicNumber: 1, status: "APPROVED" },
    fullName: "Сапаров Ерлан",
    iinLast4: "1234",
    emailVerified: true,
    mfa: { required: false, verifiedAt: null },
    consents: [CURRENT],
    consentRevocationOpen: false,
    ...over,
  } as unknown as CurrentUser;
}

/** Куда ушла страница: адрес redirect(), `NOT_FOUND` для notFound(). */
async function outcome(id: string): Promise<string> {
  try {
    await MasterRequestChat({ params: Promise.resolve({ id }) });
  } catch (e) {
    const digest = (e as { digest?: string }).digest ?? "";
    if (digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2] ?? "";
    if (digest.startsWith("NEXT_HTTP_ERROR_FALLBACK;404")) return "NOT_FOUND";
    throw e;
  }
  throw new Error("страница должна была уйти");
}

beforeEach(() => {
  h.user = person();
  h.request = { id: "r1", myOffer: { id: "o9" } };
  h.error = null;
  h.asked = [];
});

describe("/v2/executor/requests/<id>/chat — диалог мастера по заявке", () => {
  it("своё предложение есть — диалог по нему", async () => {
    expect(await outcome("r1")).toBe("/v2/chats/o9");
    expect(h.asked).toEqual(["r1"]);
  });

  it("предложения нет — экран заявки", async () => {
    h.request = { id: "r1", myOffer: null };
    expect(await outcome("r1")).toBe("/v2/executor/requests/r1");
  });

  it("неодобренный мастер (модуль: notApproved) — экран заявки, он объяснит статус", async () => {
    h.user = person({ executor: { id: "e1", publicNumber: 1, status: "PENDING" } });
    h.error = new AppError("FORBIDDEN", "не одобрен");
    expect(await outcome("r1")).toBe("/v2/executor/requests/r1");
  });

  it("чужая и несуществующая заявка — 404; прочие ошибки не маскируются", async () => {
    h.error = new AppError("NOT_FOUND", "нет");
    expect(await outcome("r1")).toBe("NOT_FOUND");
    h.error = new Error("база недоступна");
    await expect(MasterRequestChat({ params: Promise.resolve({ id: "r1" }) })).rejects.toThrow("база недоступна");
  });

  it("покупатель с выданной ролью мастера — переключение роли с возвратом сюда; без роли — его дом", async () => {
    h.user = person({ role: "CLIENT", roles: ["CLIENT", "EXECUTOR"] });
    expect(await outcome("r1")).toBe(`/v2/switch-role?to=EXECUTOR&returnTo=${encodeURIComponent("/v2/executor/requests/r1/chat")}`);
    h.user = person({ role: "CLIENT", roles: ["CLIENT"], executor: null });
    expect(await outcome("r1")).toBe("/v2");
    expect(h.asked).toEqual([]);
  });

  it("гость — вход с возвратом; id в адресах экранируется", async () => {
    h.user = null;
    expect(await outcome("a/b")).toBe(`/v2/login?next=${encodeURIComponent("/v2/executor/requests/a%2Fb/chat")}`);
    h.user = person();
    h.request = { id: "a/b", myOffer: { id: "o/1" } };
    expect(await outcome("a/b")).toBe("/v2/chats/o%2F1");
  });
});
