import { isRedirectError } from "next/dist/client/components/redirect-error";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { getCurrentUser } from "@/modules/identity";
import type { ActionResult } from "@/platform/action";
import { db } from "@/platform/db";
import { makeClient, makeExecutor } from "../../../../../test/factories";
import { freshBrowser, setEnv } from "../../../../../test/factories/identity";
import { signInAs } from "../../../../../test/factories/session";

vi.mock("next/headers", async () => (await import("../../../../../test/factories/identity")).nextHeadersMock);
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
}));
vi.mock("@/platform/device", () => ({ getDevice: async () => "mobile" }));

const { switchRoleAction } = await import("./actions");
const { default: SwitchRolePage } = await import("./page");

const t = ru.app.profile.switchRole;

beforeEach(() => {
  freshBrowser({ "user-agent": "vitest" });
  setEnv({ DEMO_MODE: "true", SMS_PROVIDER: "mock" });
});

async function run<T>(p: Promise<ActionResult<T>>): Promise<{ redirect: string } | ActionResult<T>> {
  try {
    return await p;
  } catch (err) {
    if (!isRedirectError(err)) throw err;
    return { redirect: err.digest.split(";")[2] };
  }
}

async function render(params: Record<string, string>) {
  try {
    return { html: renderToStaticMarkup((await SwitchRolePage({ searchParams: Promise.resolve(params) })) as ReactElement) };
  } catch (e) {
    if (isRedirectError(e)) return { redirect: e.digest.split(";")[2] };
    if (e instanceof Error && String((e as { digest?: unknown }).digest).includes("404")) return { notFound: true };
    throw e;
  }
}

/** Вошёл человек с подтверждённой почтой (первые шаги пройдены). */
async function signed(user: { id: string }, role?: "CLIENT" | "EXECUTOR") {
  await db.user.update({ where: { id: user.id }, data: { email: `u${user.id.slice(0, 8)}@mail.kz`, emailVerifiedAt: new Date() } });
  await signInAs(user, role);
}

const primaryCount = (html: string) => html.split("data-primary-action").length - 1;

/** Человек с ролями покупателя и мастера, вошедший покупателем. */
async function both() {
  const user = await makeExecutor({ roles: ["CLIENT", "EXECUTOR"] });
  await signed(user, "CLIENT");
  return user;
}

describe("switchRoleAction", () => {
  it("выданная роль: активная роль меняется, переход на возврат (путь v2)", async () => {
    await both();
    expect(await run(switchRoleAction({ role: "EXECUTOR", returnTo: "/v2/deals/7" }))).toEqual({ redirect: "/v2/deals/7" });
    expect((await getCurrentUser())!.role).toBe("EXECUTOR");
  });

  it("без возврата — дом новой роли: мастера — рабочий экран v1 (входящие заявки), а не заглушка v2; покупателя — главная v2", async () => {
    await both();
    expect(await run(switchRoleAction({ role: "EXECUTOR" }))).toEqual({ redirect: "/executor/requests" });
    expect(await run(switchRoleAction({ role: "CLIENT" }))).toEqual({ redirect: "/v2" });
  });

  it("мастер без одобренного профиля: без возврата — регистрация мастера в v1", async () => {
    const user = await makeExecutor({ roles: ["CLIENT", "EXECUTOR"] });
    await db.executorProfile.update({ where: { userId: user.id }, data: { status: "PENDING" } });
    await signed(user, "CLIENT");
    expect(await run(switchRoleAction({ role: "EXECUTOR" }))).toEqual({ redirect: "/register/executor" });
  });

  it("чужой и не-v2 возврат отбрасывается: идёт в дом", async () => {
    await both();
    for (const returnTo of ["//evil.example/x", "https://evil.example", "/deals/1", "/v2/login", "/\\evil.example"]) {
      expect(await run(switchRoleAction({ role: "EXECUTOR", returnTo }))).toEqual({ redirect: "/executor/requests" });
    }
  });

  it("только выданная роль: покупатель без роли мастера не переключается", async () => {
    await signed(await makeClient());
    expect(await run(switchRoleAction({ role: "EXECUTOR" }))).toMatchObject({ ok: false });
    expect((await getCurrentUser())!.role).toBe("CLIENT");
  });

  it("роль вне переключателя — ошибка схемы; гость — UNAUTHENTICATED", async () => {
    expect(await run(switchRoleAction({ role: "OPERATOR" } as never))).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await run(switchRoleAction({ role: "EXECUTOR" }))).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
  });

  it("двойное нажатие — одна и та же итоговая роль без ошибок", async () => {
    await both();
    const results = await Promise.all([run(switchRoleAction({ role: "EXECUTOR" })), run(switchRoleAction({ role: "EXECUTOR" }))]);
    for (const r of results) expect(r).toMatchObject({ redirect: "/executor/requests" });
    expect((await getCurrentUser())!.role).toBe("EXECUTOR");
  });
});

describe("/v2/switch-role", () => {
  it("выдана: «Вы сейчас — покупатель», одно главное действие «Перейти в роль мастера», один h1", async () => {
    await both();
    const { html } = await render({ to: "EXECUTOR", returnTo: "/v2/deals/7" });
    expect(html).toContain(t.now("покупатель"));
    expect(html).toContain(t.action.EXECUTOR);
    expect(html).toContain(t.keeps);
    expect(html).toContain('value="/v2/deals/7"');
    expect(primaryCount(html!)).toBe(1);
    expect(html!.split("<h1").length - 1).toBe(1);
  });

  it("чужой returnTo в форму не попадает", async () => {
    await both();
    const { html } = await render({ to: "EXECUTOR", returnTo: "//evil.example" });
    expect(html).not.toContain("evil.example");
  });

  it("не выдана: покупателю — «Стать мастером» (регистрация мастера), одно действие; формы переключения нет", async () => {
    await signed(await makeClient());
    const { html } = await render({ to: "EXECUTOR" });
    expect(html).toContain(t.noRole("мастер"));
    expect(html).toContain(t.becomeMaster);
    expect(html).toContain('href="/v2/register/executor"');
    expect(html).toContain(`>${t.home}<svg`);
    expect(html).not.toContain('name="role"');
    expect(primaryCount(html!)).toBe(1);
  });

  it("мастер без роли покупателя: пояснение, действия нет", async () => {
    await signed(await makeExecutor());
    const { html } = await render({ to: "CLIENT" });
    expect(html).toContain(t.noRole("покупатель"));
    expect(html).toContain(`>${t.home}<svg`);
    expect(html).toContain('href="/v2/executor/requests"');
    expect(primaryCount(html!)).toBe(0);
  });

  it("роль уже активна — сразу на возврат или в дом", async () => {
    await signed(await makeClient());
    expect(await render({ to: "CLIENT", returnTo: "/v2/deals/7" })).toEqual({ redirect: "/v2/deals/7" });
    expect(await render({ to: "CLIENT" })).toEqual({ redirect: "/v2" });
  });

  it("роль мастера уже активна, возврата нет — рабочий экран мастера в v1", async () => {
    const user = await makeExecutor({ roles: ["CLIENT", "EXECUTOR"] });
    await signed(user, "EXECUTOR");
    expect(await render({ to: "EXECUTOR" })).toEqual({ redirect: "/executor/requests" });
  });

  it("без `to` (прямой адрес): покупатель с ролью мастера — «Вы сейчас — покупатель» и «Перейти в роль мастера»", async () => {
    await both();
    const { html } = await render({});
    expect(html).toContain(t.now("покупатель"));
    expect(html).toContain(t.action.EXECUTOR);
    expect(html).toContain('name="role" value="EXECUTOR"');
    expect(primaryCount(html!)).toBe(1);
  });

  it("без `to`: покупатель без роли мастера — кто он сейчас и «Стать мастером», не 404", async () => {
    await signed(await makeClient());
    const { html } = await render({});
    expect(html).toContain(t.now("покупатель"));
    expect(html).toContain(t.becomeMasterBody);
    expect(html).toContain(t.becomeMaster);
    expect(primaryCount(html!)).toBe(1);
  });

  it("без `to`: мастер с ролью покупателя — «Перейти к покупкам»; гость — вход с возвратом", async () => {
    const user = await makeExecutor({ roles: ["CLIENT", "EXECUTOR"] });
    await signed(user, "EXECUTOR");
    const { html } = await render({});
    expect(html).toContain(t.now("мастер"));
    expect(html).toContain(t.action.CLIENT);
    freshBrowser({ "user-agent": "vitest" });
    expect(await render({})).toEqual({ redirect: `/v2/login?next=${encodeURIComponent("/v2/switch-role")}` });
  });

  it("неизвестная роль — 404; гость — вход с возвратом на этот же экран", async () => {
    expect(await render({ to: "OPERATOR" })).toEqual({ notFound: true });
    expect(await render({ to: "EXECUTOR", returnTo: "/v2/deals/7" })).toEqual({
      redirect: `/v2/login?next=${encodeURIComponent("/v2/switch-role?to=EXECUTOR&returnTo=%2Fv2%2Fdeals%2F7")}`,
    });
  });
});
