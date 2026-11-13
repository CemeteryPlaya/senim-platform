import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ru } from "@/i18n/ru";
import { formatMoney } from "@/kit";
import { computeDealMoney } from "@/modules/payments/client";
import { cancelDeal } from "@/modules/deal-core";
import { acceptPrice, cancelRequest, proposePrice, sendOffer, withdrawOffer, withdrawPrice } from "@/modules/requests";
import { db } from "@/platform/db";
import { makeClient, makeExecutor } from "../../../../../../../../test/factories";
import { dealAt, PRICE } from "../../../../../../../../test/factories/deal";
import { freshBrowser } from "../../../../../../../../test/factories/identity";
import { makeExecutorWithTerms, makeOpenRequest, offerInput, openProposal } from "../../../../../../../../test/factories/requests";
import { signInAs } from "../../../../../../../../test/factories/session";

const h = vi.hoisted(() => ({ device: "mobile" as "mobile" | "desktop" }));
vi.mock("@/platform/device", () => ({ getDevice: async () => h.device }));
vi.mock("next/headers", async () => (await import("../../../../../../../../test/factories/identity")).nextHeadersMock);
// Клиентские кнопки торга берут роутер; в статическом рендере его нет.
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ push() {}, refresh() {} }),
}));

const { default: OfferPage, metadata } = await import("./page");

const t = ru.app.offer;

beforeEach(() => {
  freshBrowser({ "user-agent": "vitest" });
  h.device = "mobile";
});

const render = async (id: string, offerId: string) => renderToStaticMarkup(await OfferPage({ params: Promise.resolve({ id, offerId }) }));
const count = (out: string, needle: string) => out.split(needle).length - 1;
/** Подписи главных действий: кнопка или ссылка с data-primary-action. */
const primaries = (out: string) => [...out.matchAll(/<(?:a|button) [^>]*data-primary-action[^>]*>([\s\S]*?)<\/(?:a|button)>/g)].map((m) => m[1].replace(/<[^>]+>/g, ""));
/** HTML без разметки и сущностей: для поиска сумм и текстов (неразрывные пробелы — как есть). */
const text = (out: string) => out.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");

const SECRETS = { legalName: "ТОО «Секретная Мебель»", instagram: "secret_master_insta", phone: "+77015550199" };

/** Покупатель, прошедший первые шаги (почта подтверждена): ворота v2 пускают его на экран. */
async function buyer() {
  const client = await makeClient("Сапаров Ерлан Ержанович");
  await db.user.update({ where: { id: client.id }, data: { emailVerifiedAt: new Date() } });
  return client;
}

/** Своя заявка и предложение мастера (наименование, телефон, Instagram — в профиле; на экран они попасть не должны). */
async function offered(priceKzt = 1_180_000) {
  const client = await buyer();
  const requestId = await makeOpenRequest(client, { segment: "COMFORT" });
  const executor = await makeExecutor({ segment: "COMFORT", legalName: SECRETS.legalName });
  await db.user.update({ where: { id: executor.id }, data: { phone: SECRETS.phone, instagram: SECRETS.instagram } });
  const { offerId } = await sendOffer(executor, { ...offerInput(requestId, priceKzt), comment: "Своё производство." });
  await signInAs(client);
  return { client, requestId, executor, offerId };
}

describe("экран предложения: состояния торга", () => {
  it.each(["mobile", "desktop"] as const)("%s (1) цена мастера: «Принять X», смета с защитой 2%, один h1, «Назад» к заявке", async (device) => {
    h.device = device;
    const { requestId, executor, offerId } = await offered(1_180_000);
    const out = await render(requestId, offerId);
    const m = computeDealMoney(1_180_000_00n);

    expect(count(out, "<h1")).toBe(1);
    expect(out).toMatch(new RegExp(`<h1[^>]*>${t.title}</h1>`));
    expect(text(out)).toContain(`Исполнитель №${executor.executor.publicNumber}`);
    expect(primaries(out)).toEqual([t.actions.accept(formatMoney(m.priceTiyn))]);
    expect(out).toContain(t.actions.propose);
    expect(out).toContain(`href="/v2/requests/${requestId}"`);
    expect(out).toContain(`href="/v2/executors/${executor.executor.publicNumber}"`);
    expect(out).toContain(`href="/v2/chats/${offerId}"`);
    const plain = text(out);
    expect(plain).toContain(t.money.title);
    expect(plain).toContain(t.money.protection);
    expect(plain).toContain(t.money.explain.label);
    for (const amount of [m.priceTiyn, m.protectionTiyn, m.buyerTotalTiyn]) expect(plain).toContain(formatMoney(amount));
    expect(plain).toContain("Своё производство.");
    if (device === "mobile") expect(out).toContain("data-action-dock");
  });

  it("смета: защита сделки 2% вверх до тиына — значения computeDealMoney (цена с тиынами)", async () => {
    const { requestId, offerId } = await offered();
    const opening = await openProposal(offerId);
    await db.priceProposal.update({ where: { id: opening.id }, data: { amountTiyn: 1_000_000_01n } });
    const plain = text(await render(requestId, offerId));
    const m = computeDealMoney(1_000_000_01n);
    expect(m.protectionTiyn).toBe(2_000_001n);
    for (const amount of [m.priceTiyn, m.protectionTiyn, m.buyerTotalTiyn]) expect(plain).toContain(formatMoney(amount));
  });

  it("(2) своё предложение ждёт мастера: главного действия нет, «Отозвать предложение», смета по своей цене", async () => {
    const { client, requestId, offerId } = await offered();
    await proposePrice(client, { offerId, amountKzt: 1_000_000 });
    const out = await render(requestId, offerId);
    expect(primaries(out)).toEqual([]);
    expect(out).toContain(t.now.waiting.title);
    expect(out).toContain(t.actions.withdraw);
    expect(out).not.toContain(t.actions.propose);
    expect(text(out)).toContain(t.money.price.yours);
    expect(text(out)).toContain(formatMoney(computeDealMoney(1_000_000_00n).buyerTotalTiyn));
  });

  it("(3) мастер ответил новой ценой: «Принять» его цену; история — кто, сколько, заменённые помечены", async () => {
    const { client, executor, requestId, offerId } = await offered(1_020_000);
    await proposePrice(client, { offerId, amountKzt: 940_000 });
    await proposePrice(executor, { offerId, amountKzt: 990_000 });
    const out = await render(requestId, offerId);
    expect(primaries(out)).toEqual([t.actions.accept(formatMoney(990_000_00n))]);
    expect(out).toContain(t.now.masterCounter.title(formatMoney(990_000_00n)));
    expect(out).toContain(t.history.title);
    expect(count(out, t.history.status.SUPERSEDED)).toBe(2);
    expect(count(out, t.history.you)).toBe(1);
  });

  it("покупатель отозвал своё: «Предложить свою цену» — единственное главное, сметы нет", async () => {
    const { client, requestId, offerId } = await offered();
    const { proposalId } = await proposePrice(client, { offerId, amountKzt: 1_000_000 });
    await withdrawPrice(client, { proposalId });
    const out = await render(requestId, offerId);
    expect(primaries(out)).toEqual([t.actions.propose]);
    expect(out).toContain(t.now.youWithdrew.title);
    expect(out).toContain(t.history.status.WITHDRAWN);
    expect(out).not.toContain(t.money.protection);
  });

  it.each(["mobile", "desktop"] as const)("%s (4) цена принята: «Открыть сделку» на /v2/deals/<id>, цена сделки строкой, блока денег нет", async (device) => {
    h.device = device;
    const { client, requestId, offerId } = await offered();
    const { dealId } = await acceptPrice(client, { proposalId: (await openProposal(offerId)).id });
    const out = await render(requestId, offerId);
    expect(primaries(out)).toEqual([t.actions.openDeal]);
    expect(out).toContain(`href="/v2/deals/${dealId}"`);
    expect(out).toContain(t.now.deal.title);
    expect(text(out)).toContain(t.now.deal.body(formatMoney(1_180_000_00n)));
    expect(out).not.toContain(t.actions.propose);
    expect(out).not.toContain(t.money.total);
    expect(out).not.toContain(t.money.protection);
  });

  it("(4) сделка отменена — по-прежнему «Открыть сделку», и нигде нет «К оплате»", async () => {
    const { client, requestId, offerId } = await offered();
    const { dealId } = await acceptPrice(client, { proposalId: (await openProposal(offerId)).id });
    await cancelDeal(client, { dealId, reason: "" });
    expect((await db.deal.findUniqueOrThrow({ where: { id: dealId } })).status).toBe("CANCELLED");
    const out = await render(requestId, offerId);
    expect(primaries(out)).toEqual([t.actions.openDeal]);
    expect(out).not.toContain(t.money.total);
    expect(out).not.toContain(t.money.title);
  });

  it("(4) сделка оплачена (деньги в банке) — на экране предложения нет «К оплате»", async () => {
    const client = await buyer();
    const deal = await dealAt("PAID_HOLD", { client });
    // Сделка фабрики создана без торга: принятая цена — как её пишет acceptPrice (иначе модуль не свяжет торг со сделкой).
    await db.priceProposal.create({ data: { offerId: deal.offerId, authorId: deal.executor.id, party: "EXECUTOR", amountTiyn: PRICE, status: "ACCEPTED" } });
    expect((await db.deal.findUniqueOrThrow({ where: { id: deal.dealId } })).status).toBe("PAID_HOLD");
    await signInAs(client);
    const out = await render(deal.requestId, deal.offerId);
    expect(primaries(out)).toEqual([t.actions.openDeal]);
    expect(out).toContain(`href="/v2/deals/${deal.dealId}"`);
    expect(out).not.toContain(t.money.total);
    expect(out).not.toContain(t.money.title);
  });

  it("(5) выбран другой мастер: объяснение без действий; в истории его цена «Не принята»", async () => {
    const { client, requestId, offerId } = await offered();
    const other = await makeExecutorWithTerms("COMFORT");
    const { offerId: otherOffer } = await sendOffer(other, offerInput(requestId, 900_000));
    await acceptPrice(client, { proposalId: (await openProposal(otherOffer)).id });
    const out = await render(requestId, offerId);
    expect(out).toContain(t.now.otherChosen.title);
    expect(primaries(out)).toEqual([]);
    expect(out).not.toContain(t.actions.propose);
    expect(out).not.toContain(t.actions.withdraw);
    expect(out).not.toContain(t.money.protection);
    expect(out).toContain(t.history.notAccepted);
    expect(out).not.toContain(t.history.status.PROPOSED);
  });

  it("(5) заявка отменена: объяснение без действий", async () => {
    const { client, requestId, offerId } = await offered();
    await cancelRequest(client, { requestId });
    const out = await render(requestId, offerId);
    expect(out).toContain(t.now.requestCancelled.title);
    expect(primaries(out)).toEqual([]);
  });
});

describe("экран предложения: приватность мастера", () => {
  it.each(["mobile", "desktop"] as const)("%s: в HTML нет наименования, телефона, Instagram и ИИН/БИН мастера", async (device) => {
    h.device = device;
    const { requestId, executor, offerId } = await offered();
    const out = await render(requestId, offerId);
    const profile = await db.executorProfile.findFirstOrThrow({ where: { id: executor.executor.id } });
    expect(out).not.toContain("Секретная");
    expect(out).not.toContain(SECRETS.instagram);
    expect(out).not.toContain(SECRETS.phone);
    expect(out).not.toContain(SECRETS.phone.slice(-7));
    expect(out).not.toContain(profile.binIinLast4);
    expect(out).not.toMatch(/\b\d{12}\b/);
    expect(out).not.toMatch(/instagram/i);
    for (const attr of out.matchAll(/\s(?:alt|title|aria-label|data-[a-z-]+)="([^"]*)"/g)) {
      expect(attr[1]).not.toMatch(/Секретная|secret_master|\+7\d{10}/);
    }
  });

  it("заголовок вкладки — без подписи мастера", () => {
    expect(metadata).toEqual({ title: t.metaTitle });
    expect(String(metadata.title)).not.toMatch(/Исполнитель|№/);
  });
});

describe("экран предложения: 404", () => {
  const notFound = { digest: expect.stringContaining("404") };

  it("чужая заявка", async () => {
    const { requestId, offerId } = await offered();
    await signInAs(await buyer());
    await expect(render(requestId, offerId)).rejects.toMatchObject(notFound);
  });

  it("несуществующая заявка; предложение своей другой заявки под чужой заявкой", async () => {
    const { requestId, offerId } = await offered();
    await expect(render("no-such-request", offerId)).rejects.toMatchObject(notFound);
    await signInAs(await buyer());
    await expect(render(requestId, "no-such-offer")).rejects.toMatchObject(notFound);
  });

  it("своя заявка, а предложения нет (мастер отозвал его целиком, адрес устарел) — на карточку заявки", async () => {
    const { requestId, executor, offerId } = await offered();
    await withdrawOffer(executor, { offerId });
    const toRequest = { digest: expect.stringContaining(`;/v2/requests/${requestId};`) };
    await expect(render(requestId, offerId)).rejects.toMatchObject(toRequest);
    await expect(render(requestId, "no-such-offer")).rejects.toMatchObject(toRequest);
  });
});
