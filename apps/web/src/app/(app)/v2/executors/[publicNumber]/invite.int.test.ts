import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ru } from "@/i18n/ru";
import { inviteExecutor } from "@/modules/requests";
import { db } from "@/platform/db";
import { makeClient, makeExecutor } from "../../../../../../test/factories";
import { freshBrowser } from "../../../../../../test/factories/identity";
import { makeOpenRequest } from "../../../../../../test/factories/requests";
import { signInAs } from "../../../../../../test/factories/session";

const h = vi.hoisted(() => ({ device: "mobile" as "mobile" | "desktop" }));
vi.mock("@/platform/device", () => ({ getDevice: async () => h.device }));
vi.mock("next/headers", async () => (await import("../../../../../../test/factories/identity")).nextHeadersMock);
// Клиентские кнопки берут роутер приложения; в статическом рендере его нет.
vi.mock("next/navigation", async (original) => ({ ...(await original<typeof import("next/navigation")>()), useRouter: () => ({ refresh() {}, push() {} }) }));

const { default: ExecutorPage } = await import("./page");

const t = ru.app.guest.executor;
const i = t.invite;

beforeEach(() => {
  freshBrowser({ "user-agent": "vitest" });
  h.device = "mobile";
});

const render = async (publicNumber: number, search: Record<string, string> = {}) =>
  renderToStaticMarkup(await ExecutorPage({ params: Promise.resolve({ publicNumber: String(publicNumber) }), searchParams: Promise.resolve(search) }));
const count = (out: string, needle: string) => out.split(needle).length - 1;
/** Подписи главных действий (кнопка или ссылка с data-primary-action). */
const primaries = (out: string) => [...out.matchAll(/<(?:a|button) [^>]*data-primary-action[^>]*>([\s\S]*?)<\/(?:a|button)>/g)].map((m) => m[1].replace(/<[^>]+>/g, ""));

async function buyer() {
  const client = await makeClient("Сапаров Ерлан Ержанович");
  await db.user.update({ where: { id: client.id }, data: { emailVerifiedAt: new Date() } });
  return client;
}

async function request(client: Awaited<ReturnType<typeof buyer>>, segment: "ECONOMY" | "COMFORT" = "COMFORT") {
  const id = await makeOpenRequest(client, { segment });
  const { number } = await db.request.findUniqueOrThrow({ where: { id }, select: { number: true } });
  return { id, number };
}

describe("страница мастера: приглашение к заказу", () => {
  it.each(["mobile", "desktop"] as const)("%s: заказ из адреса, та же группа — «Пригласить к заказу №N» главная, «Предложить заказ» тихая", async (device) => {
    h.device = device;
    const client = await buyer();
    const master = await makeExecutor({ segment: "COMFORT" });
    const { id, number } = await request(client);
    await signInAs(client);
    const out = await render(master.executor.publicNumber, { request: id });
    expect(primaries(out)).toEqual([i.action(number)]);
    expect(out).toContain(t.action);
    expect(count(out, "<h1")).toBe(1);
    expect(out).toContain(`href="/v2/executors?request=${id}"`);
  });

  it("приглашение уже отправлено — «Приглашение отправлено», кнопки приглашения нет, главное — «Предложить заказ»", async () => {
    const client = await buyer();
    const master = await makeExecutor({ segment: "COMFORT" });
    const { id, number } = await request(client);
    await inviteExecutor(client, { requestId: id, publicNumber: master.executor.publicNumber });
    await signInAs(client);
    const out = await render(master.executor.publicNumber, { request: id });
    expect(out).toContain(i.sent(number));
    expect(out).not.toContain(i.action(number));
    expect(primaries(out)).toEqual([t.action]);
  });

  it("мастер другой группы — «Работает в другой ценовой группе», без кнопки приглашения", async () => {
    const client = await buyer();
    const master = await makeExecutor({ segment: "PREMIUM" });
    const { id } = await request(client);
    await signInAs(client);
    const out = await render(master.executor.publicNumber, { request: id });
    expect(out).toContain(i.otherSegment);
    expect(out).not.toContain("Пригласить к заказу");
    expect(primaries(out)).toEqual([t.action]);
  });

  it("без заказа в адресе, но есть подходящий свой заказ — кнопка с выбором в шторке; один главный", async () => {
    const client = await buyer();
    const master = await makeExecutor({ segment: "COMFORT" });
    await request(client);
    await signInAs(client);
    for (const device of ["mobile", "desktop"] as const) {
      h.device = device;
      const out = await render(master.executor.publicNumber);
      expect(primaries(out)).toEqual([i.pick]);
      expect(out).toContain(t.action);
      expect(out).toContain('href="/v2/executors"');
    }
  });

  it("чужой заказ в адресе — как без заказа; нет подходящих заказов — приглашения нет", async () => {
    const owner = await buyer();
    const other = await buyer();
    const master = await makeExecutor({ segment: "COMFORT" });
    const foreign = await request(owner);
    await signInAs(other);
    const out = await render(master.executor.publicNumber, { request: foreign.id });
    expect(out).not.toContain("Пригласить к заказу");
    expect(out).not.toContain(i.otherSegment);
    expect(primaries(out)).toEqual([t.action]);
  });

  it("гость и мастер: приглашения нет, «Предложить заказ» как раньше", async () => {
    const client = await buyer();
    const master = await makeExecutor({ segment: "COMFORT" });
    const { id } = await request(client);
    for (const who of [null, await makeExecutor({ segment: "COMFORT" })]) {
      freshBrowser({ "user-agent": "vitest" });
      if (who) {
        await db.user.update({ where: { id: who.id }, data: { emailVerifiedAt: new Date() } });
        await signInAs(who);
      }
      const out = await render(master.executor.publicNumber, { request: id });
      expect(out).not.toContain("Пригласить к заказу");
      expect(out).not.toContain(i.otherSegment);
      expect(primaries(out)).toEqual([t.action]);
    }
  });
});
