import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, Fragment, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ru } from "@/i18n/ru";
import { sendOffer } from "@/modules/requests";
import { db } from "@/platform/db";
import { makeAdmin, makeClient, makeExecutor, makeOperator } from "../../../../test/factories";
import { dealAt } from "../../../../test/factories/deal";
import { freshBrowser } from "../../../../test/factories/identity";
import { makeDraft, makeExecutorWithTerms, makeOpenRequest, offerInput } from "../../../../test/factories/requests";
import { signInAs } from "../../../../test/factories/session";
import V2Home from "./(home)/page";

const h = vi.hoisted(() => ({ device: "mobile" as "mobile" | "desktop" }));
vi.mock("@/platform/device", () => ({ getDevice: async () => h.device }));
vi.mock("next/headers", async () => (await import("../../../../test/factories/identity")).nextHeadersMock);

const t = ru.app.buyer.home;

beforeEach(() => {
  freshBrowser({ "user-agent": "vitest" });
  h.device = "mobile";
});

/** Страница отдаёт серверный компонент-«загрузчик» (async): React в тесте его не ждёт — раскрываем один уровень сами. */
async function render(): Promise<string> {
  const page = await V2Home();
  if (isValidElement(page) && typeof page.type === "function") {
    const component = page.type as (props: unknown) => ReactNode | Promise<ReactNode>;
    return renderToStaticMarkup(createElement(Fragment, null, await component(page.props)));
  }
  return renderToStaticMarkup(page);
}
/** Куда уходит главная: адрес перехода или «page», если она нарисовалась. */
async function where(): Promise<string> {
  try {
    await render();
    return "page";
  } catch (e) {
    const digest = typeof e === "object" && e !== null && "digest" in e ? String((e as { digest: unknown }).digest) : "";
    return digest.startsWith("NEXT_REDIRECT") ? (digest.split(";")[2] ?? "") : digest || "error";
  }
}
const primaries = (out: string) => [...out.matchAll(/<a [^>]*data-primary-action[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map((m) => ({ href: m[1], label: m[2] }));
const h2s = (out: string) => [...out.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((m) => m[1]);

/** Заказчик, прошедший первые шаги (почта подтверждена), — до входа, чтобы подделка identity взяла его уже готовым. */
async function buyer(fullName = "Сапаров Ерлан Ержанович") {
  const client = await makeClient(fullName);
  await db.user.update({ where: { id: client.id }, data: { emailVerifiedAt: new Date() } });
  return client;
}

describe("/v2 для покупателя: по одному главному действию", () => {
  it("новый человек: приветствие по имени, первые шаги, «Закажите мебель» — единственная кнопка «Заказать мебель»", async () => {
    await signInAs(await buyer());
    const out = await render();
    expect(out.match(/<h1[^>]*>([^<]*)<\/h1>/)?.[1]).toBe("Здравствуйте, Ерлан");
    expect(out).toContain(ru.app.kit.firstSteps.left(3));
    expect(h2s(out)).toContain(t.now.order.title);
    expect(primaries(out)).toEqual([{ href: "/v2/requests/new", label: "Заказать мебель" }]);
    expect(out).not.toContain(t.requests.section);
    expect(out).not.toContain(t.deal.section);
  });

  it("заявка ждёт предложений: «Ждём предложений мастеров», главной кнопки нет, ссылка на заявку", async () => {
    const client = await buyer();
    const requestId = await makeOpenRequest(client);
    await signInAs(client);
    h.device = "desktop";
    const out = await render();
    expect(h2s(out)).toContain(t.now.requestWaiting.title);
    expect(primaries(out)).toEqual([]);
    expect(out).toContain(`href="/v2/requests/${requestId}"`);
  });

  it("заявка с предложением: «Пришло 1 предложение» и «Посмотреть предложения» в заявку", async () => {
    const client = await buyer();
    const requestId = await makeOpenRequest(client, { segment: "COMFORT" });
    await sendOffer(await makeExecutorWithTerms("COMFORT"), offerInput(requestId));
    await signInAs(client);
    const out = await render();
    expect(h2s(out)).toContain(t.now.offers.title(1));
    expect(primaries(out)).toEqual([{ href: `/v2/requests/${requestId}`, label: t.now.offers.action }]);
  });

  it("черновик: «Продолжить заявку» с параметром черновика", async () => {
    const client = await buyer();
    const draftId = await makeDraft(client);
    await signInAs(client);
    const out = await render();
    expect(primaries(out)).toEqual([{ href: `/v2/requests/new?draft=${draftId}`, label: t.now.draft.action }]);
  });

  it("сделка ждёт оплаты: «Оплатить заказ» ведёт в сделку; в карточке — название, ход и «к оплате», без пометок «тестовая»", async () => {
    const client = await buyer();
    const deal = await dealAt("SIGNED", { client });
    await signInAs(client);
    const out = await render();
    expect(primaries(out)).toEqual([{ href: `/v2/deals/${deal.dealId}`, label: t.now.pay.action }]);
    expect(out).toContain(">Тестовый заказ</a>");
    expect(out).toContain(ru.app.deal.steps[0]);
    expect(out).toContain(ru.common.home.client.toPay);
    expect(out).not.toMatch(/тестов(ый|ая) (платёж|сделк)|демо|комисси|эскроу/i);
  });

  it("сделка идёт, ждём мастера: сумма «в банке под защитой», главной кнопки нет, первых шагов нет", async () => {
    const client = await buyer();
    const deal = await dealAt("IN_PROGRESS", { client });
    await signInAs(client);
    h.device = "desktop";
    const out = await render();
    expect(h2s(out)).toContain(t.now.waiting.waitReady);
    expect(primaries(out)).toEqual([]);
    expect(out).toContain(ru.common.home.client.inBank);
    expect(out).toContain(`href="/v2/deals/${deal.dealId}"`);
    expect(out).not.toContain(ru.app.kit.firstSteps.progressLabel);
  });

  it("мебель сдана: «Принять мебель» ведёт в сделку", async () => {
    const client = await buyer();
    const deal = await dealAt("READY", { client });
    await signInAs(client);
    const out = await render();
    expect(primaries(out)).toEqual([{ href: `/v2/deals/${deal.dealId}`, label: t.now.accept.action }]);
  });

  it("чужие заявки и сделки не видны", async () => {
    const other = await buyer("Иванов Пётр Иванович");
    await makeOpenRequest(other);
    await dealAt("IN_PROGRESS", { client: other });
    await signInAs(await buyer());
    const out = await render();
    expect(h2s(out)).toContain(t.now.order.title);
    expect(out).not.toContain(t.deal.section);
  });
});

const m = ru.app.masterRequests;

/** Мастер, прошедший первые шаги: почта подтверждена. */
async function master(opts: Parameters<typeof makeExecutor>[0] = {}) {
  const executor = await makeExecutor(opts);
  await db.user.update({ where: { id: executor.id }, data: { emailVerifiedAt: new Date() } });
  return executor;
}

describe("/v2 для мастера", () => {
  it("новая заявка: «Сейчас» — новая заявка, одна кнопка ведёт в список новых; в сводке одна новая", async () => {
    const executor = await master({ segment: "COMFORT" });
    await makeOpenRequest(await buyer(), { segment: "COMFORT" });
    await signInAs(executor);
    const out = await render();
    expect(out.match(/<h1[^>]*>([^<]*)<\/h1>/)?.[1]).toMatch(/^Здравствуйте/);
    expect(h2s(out)).toContain(m.home.now.fresh.title(1));
    expect(primaries(out)).toEqual([{ href: "/v2/executor/requests?f=new", label: m.home.now.fresh.action }]);
    expect(out).toContain(m.home.requests.section);
  });

  it("сделка ждёт запуска: «Начать работу» ведёт в сделку, в карточке строка «вы получите» без суммы покупателя", async () => {
    const client = await buyer();
    const deal = await dealAt("PAID_HOLD", { client });
    await db.user.update({ where: { id: deal.executor.id }, data: { emailVerifiedAt: new Date() } });
    await signInAs(deal.executor);
    h.device = "desktop";
    const out = await render();
    expect(primaries(out)).toEqual([{ href: `/v2/deals/${deal.dealId}`, label: m.home.now.start.action }]);
    expect(out).toContain(ru.app.master.deal.line.protected);
    expect(out).not.toMatch(/комисси|эскроу|демо/i);
  });

  it.each(["PENDING", "REJECTED"] as const)("неодобренный мастер (%s): «/v2» ведёт на регистрацию — его дом, главной у него нет", async (status) => {
    await signInAs(await master({ status }));
    expect(await where()).toBe("/v2/register/executor");
  });

  it("неодобренный мастер со сделками: тоже на регистрацию (ссылка «Ваши сделки» — на экране статуса)", async () => {
    const executor = await master({ status: "PENDING" });
    await dealAt("SIGNED", { executor });
    await signInAs(executor);
    expect(await where()).toBe("/v2/register/executor");
  });

  it("первые шаги: документы и счёт не готовы — список с прогрессом, главное действие одно; первое предложение отмечается сделанным", async () => {
    const steps = ru.app.masterProfile.steps;
    const executor = await master({ segment: "COMFORT" });
    const requestId = await makeOpenRequest(await buyer(), { segment: "COMFORT" });
    await signInAs(executor);
    const before = await render();
    expect(before).toContain(ru.app.kit.firstSteps.progressLabel);
    for (const label of [steps.profile, steps.documents, steps.payout, steps.offer]) expect(before).toContain(label);
    expect(before).not.toContain(`${steps.offer}<span class="sr-only">`);
    expect(primaries(before)).toHaveLength(1);

    await sendOffer(executor, offerInput(requestId));
    const after = await render();
    expect(after).toContain(`${steps.offer}<span class="sr-only">`);
  });
});

describe("/v2 для сотрудников: главная уводит в их дом", () => {
  it("оператор — его главная, администратор — админка; администратор без второго шага — на экран кода", async () => {
    await signInAs(await makeOperator());
    expect(await where()).toBe("/v2/operator");
    freshBrowser();
    const admin = await makeAdmin();
    await signInAs(admin);
    expect(await where()).toBe("/v2/admin");
    freshBrowser();
    await signInAs(admin, undefined, { mfaVerifiedAt: null });
    expect(await where()).toBe(`/v2/operator/mfa?next=${encodeURIComponent("/v2")}`);
  });
});
