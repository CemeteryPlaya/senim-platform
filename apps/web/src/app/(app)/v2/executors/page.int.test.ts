import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ru } from "@/i18n/ru";
import { cancelRequest } from "@/modules/requests";
import { db } from "@/platform/db";
import { makeClient, makeExecutor } from "../../../../../test/factories";
import { freshBrowser } from "../../../../../test/factories/identity";
import { makeOpenRequest } from "../../../../../test/factories/requests";
import { signInAs } from "../../../../../test/factories/session";

const h = vi.hoisted(() => ({ device: "mobile" as "mobile" | "desktop" }));
vi.mock("@/platform/device", () => ({ getDevice: async () => h.device }));
vi.mock("next/headers", async () => (await import("../../../../../test/factories/identity")).nextHeadersMock);

const { default: ExecutorsPage } = await import("./page");

const t = ru.app.guest.executors;

const render = async (params: Record<string, string> = {}) => renderToStaticMarkup(await ExecutorsPage({ searchParams: Promise.resolve(params) }));

const SECRETS = { legalName: "ТОО «Секретная Мебель»", instagram: "secret_master_insta", phone: "+77015550199", street: "ул. Потайная, 7" };

beforeEach(() => {
  freshBrowser({ "user-agent": "vitest" });
  h.device = "mobile";
});

async function buyer() {
  const client = await makeClient("Сапаров Ерлан Ержанович");
  await db.user.update({ where: { id: client.id }, data: { emailVerifiedAt: new Date() } });
  return client;
}

async function master() {
  const executor = await makeExecutor({ legalName: SECRETS.legalName });
  await db.user.update({ where: { id: executor.id }, data: { phone: SECRETS.phone, instagram: SECRETS.instagram } });
  await db.executorProfile.update({ where: { id: executor.executor.id }, data: { streetAddress: SECRETS.street, ratingAvg: 4.8, reviewsCount: 12 } });
  return executor;
}

/** Обычный список: без подзаголовка (ни заявки, ни общего) и без «Назад» к ней. */
function expectPlainList(out: string) {
  expect(out).not.toContain("Оценки, сделки и работы мастеров");
  expect(out).not.toContain("Для заявки №");
  expect(out).not.toMatch(/href="\/v2\/requests\//);
}

describe("/v2/executors", () => {
  it("гость видит мастеров: метка, оценка, сделки, ссылка на профиль; без контактов, имени и id; главного действия нет", async () => {
    const executor = await master();
    const blocked = await makeExecutor();
    await db.user.update({ where: { id: blocked.id }, data: { blockedAt: new Date() } });
    const pending = await makeExecutor({ status: "PENDING" });

    const out = await render();
    expect(out).toContain(`<h1`);
    expect(out).toContain(t.title);
    expect(out).toContain(`Исполнитель №${executor.executor.publicNumber}`);
    expect(out).toContain(`href="/v2/executors/${executor.executor.publicNumber}"`);
    expect(out).toContain("4,8 · 12 отзывов");
    expect(out).toContain("Сделок: 0");
    expect(out).not.toContain(`Исполнитель №${blocked.executor.publicNumber}<`);
    expect(out).not.toContain(`Исполнитель №${pending.executor.publicNumber}<`);
    for (const secret of Object.values(SECRETS)) expect(out).not.toContain(secret);
    expect(out).not.toContain(executor.executor.id);
    expect(out).not.toContain("data-primary-action");
    expectPlainList(out);
  });

  it("никого нет — пустое состояние с одним действием", async () => {
    const out = await render();
    expect(out).toContain(t.empty.title);
    expect(out).toContain('href="/v2"');
  });

  it("своя открытая заявка на всех мастеров (путь ТЗ): подзаголовок с номером и «Назад» к заявке", async () => {
    await master();
    const client = await buyer();
    const requestId = await makeOpenRequest(client);
    const { number } = await db.request.findUniqueOrThrow({ where: { id: requestId }, select: { number: true } });
    await signInAs(client);

    const out = await render({ request: requestId });
    expect(out).toContain(t.forRequest(number));
    expect(out).toContain(`href="/v2/requests/${requestId}"`);
  });

  it("чужая, отменённая, прямая, не путь ТЗ, несуществующая заявка и гость — обычный список без ошибки", async () => {
    await master();
    const owner = await buyer();
    const other = await buyer();
    const foreign = await makeOpenRequest(owner);
    const cancelled = await makeOpenRequest(other);
    await cancelRequest(other, { requestId: cancelled });
    const direct = await makeOpenRequest(other);
    await db.request.update({ where: { id: direct }, data: { mode: "DIRECT" } });
    const preContract = await makeOpenRequest(other);
    await db.request.update({ where: { id: preContract }, data: { preContractFlow: "EXECUTOR_MEASURE" } });

    expectPlainList(await render({ request: foreign }));

    await signInAs(other);
    for (const request of [foreign, cancelled, direct, preContract, "nope", "../x"]) {
      const out = await render({ request });
      expectPlainList(out);
      expect(out).toContain("Исполнитель №");
    }
  });
});
