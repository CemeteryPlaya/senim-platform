import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ru } from "@/i18n/ru";
import { formatMoney } from "@/kit";
import { computeDealMoney } from "@/modules/payments/client";
import { acceptPrice, cancelRequest, declineInvitation, inviteExecutor, proposePrice, sendOffer, setDealAddress, withdrawOffer } from "@/modules/requests";
import { db } from "@/platform/db";
import { makeClient, makeExecutor } from "../../../../../../../test/factories";
import { freshBrowser } from "../../../../../../../test/factories/identity";
import { makeOpenRequest, offerInput, openProposal } from "../../../../../../../test/factories/requests";
import { signInAs } from "../../../../../../../test/factories/session";

const h = vi.hoisted(() => ({ device: "mobile" as "mobile" | "desktop" }));
vi.mock("@/platform/device", () => ({ getDevice: async () => h.device }));
vi.mock("next/headers", async () => (await import("../../../../../../../test/factories/identity")).nextHeadersMock);
// Клиентские кнопки и форма берут роутер; в статическом рендере его нет.
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ push() {}, refresh() {} }),
}));

const { default: MasterRequestPage, metadata } = await import("./page");

const t = ru.app.masterOffer;

beforeEach(() => {
  freshBrowser({ "user-agent": "vitest" });
  h.device = "mobile";
});

const render = async (id: string) => renderToStaticMarkup(await MasterRequestPage({ params: Promise.resolve({ id }) }));
const count = (out: string, needle: string) => out.split(needle).length - 1;
/** Подписи главных действий: кнопка или ссылка с data-primary-action. */
const primaries = (out: string) => [...out.matchAll(/<(?:a|button) [^>]*data-primary-action[^>]*>([\s\S]*?)<\/(?:a|button)>/g)].map((m) => m[1].replace(/<[^>]+>/g, ""));
/** HTML без разметки и сущностей: для поиска сумм и текстов (неразрывные пробелы — как есть). */
const text = (out: string) => out.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&quot;/g, '"');

/** Имя, телефон и почта покупателя: до оферты на экран мастера не попадают. */
const BUYER = { name: "Сапаров Ерлан Ержанович", phone: "+77015550177", email: "buyer.secret@example.com" };
const ADDRESS = "ул. Тестовая, 1, кв. 2";

/** Покупатель с именем, телефоном и почтой (первый — с теми, что ищутся на экране); его открытая заявка уровня COMFORT. */
async function buyerRequest(secrets = true) {
  const client = await makeClient(BUYER.name);
  if (secrets) await db.user.update({ where: { id: client.id }, data: { phone: BUYER.phone, email: BUYER.email } });
  const requestId = await makeOpenRequest(client, { segment: "COMFORT" });
  return { client, requestId };
}

/** Одобренный мастер, прошедший первые шаги (почта подтверждена), вошедший в роли мастера. */
async function master(opts: Parameters<typeof makeExecutor>[0] = { segment: "COMFORT" }) {
  const executor = await makeExecutor(opts);
  await db.user.update({ where: { id: executor.id }, data: { emailVerifiedAt: new Date() } });
  await signInAs(executor);
  return executor;
}

function expectNoBuyer(out: string) {
  for (const secret of [BUYER.name, "Сапаров", BUYER.phone, BUYER.email]) expect(out).not.toContain(secret);
}

describe("заявка мастера: состояния", () => {
  it.each(["mobile", "desktop"] as const)("%s форма: «Отправить предложение» — единственное главное, адреса нет (ни строки, ни пояснения), покупатель не назван", async (device) => {
    h.device = device;
    const { requestId } = await buyerRequest();
    await master();
    const out = await render(requestId);
    expect(count(out, "<h1")).toBe(1);
    expect(primaries(out)).toEqual([t.form.submit]);
    const plain = text(out);
    for (const s of [t.now.form.title, t.form.title, t.form.price, t.form.days, t.form.warranty, t.form.moneyEmpty, t.request.contacts]) {
      expect(plain).toContain(s);
    }
    expect(plain).not.toContain(ADDRESS);
    expect(plain).not.toContain(t.request.address);
    expect(out).toContain('id="master-offer-form"');
    expect(out).toContain('form="master-offer-form"');
    expect(out).toContain('href="/v2/executor/requests"');
    expectNoBuyer(out);
    expect(plain).not.toMatch(/2\s?%|защит[аыеу] сделки|комисси|эскроу|заказчик/i);
    expect(metadata).toEqual({ title: t.metaTitle });
  });

  it.each(["mobile", "desktop"] as const)("%s цена покупателя: «Принять X», смета «Вы получите» без защиты и суммы к оплате покупателя", async (device) => {
    h.device = device;
    const { client, requestId } = await buyerRequest();
    const executor = await master();
    const { offerId } = await sendOffer(executor, { ...offerInput(requestId, 500_000), comment: "Фурнитура Blum." });
    await proposePrice(client, { offerId, amountKzt: 450_000 });
    const out = await render(requestId);
    const m = computeDealMoney(450_000_00n);
    expect(count(out, "<h1")).toBe(1);
    expect(primaries(out)).toEqual([t.actions.accept(formatMoney(m.priceTiyn))]);
    const plain = text(out);
    for (const s of [t.now.buyerPrice.title(formatMoney(m.priceTiyn)), t.actions.propose, t.money.guarantee, t.money.youGet, t.history.title, "Фурнитура Blum."]) {
      expect(plain).toContain(s);
    }
    // «Вы получите» — крупная сумма: число и «₸» в разных элементах, поэтому сравнение без разницы в пробелах.
    const squeezed = (s: string) => s.replace(/\s+/g, " ");
    for (const amount of [m.priceTiyn, m.guaranteeTiyn, m.payoutTiyn]) expect(squeezed(plain)).toContain(squeezed(formatMoney(amount)));
    // ADR-015: покупатель платит цену без доплат — его сумма равна цене, отдельной суммы покупателя нет.
    expect(m.buyerTotalTiyn).toBe(m.priceTiyn);
    expect(plain).not.toMatch(/защит[аыеу] сделки|к оплате/i);
    expect(out).toContain(`href="/v2/chats/${offerId}"`);
    expect(out).toContain(t.actions.menu);
    expectNoBuyer(out);
  });

  it("своя цена ждёт — главного нет, «Отозвать цену»; отозвал предложение целиком — закрыто, меню нет", async () => {
    const { requestId } = await buyerRequest();
    const executor = await master();
    const { offerId } = await sendOffer(executor, offerInput(requestId, 500_000));
    let out = await render(requestId);
    expect(primaries(out)).toEqual([]);
    expect(text(out)).toContain(t.now.waiting.title);
    expect(text(out)).toContain(t.actions.withdrawPrice);
    expect(text(out)).toContain(t.money.titleWaiting);

    await withdrawOffer(executor, { offerId });
    out = await render(requestId);
    expect(text(out)).toContain(t.now.withdrawn.title);
    expect(out).not.toContain(t.actions.menu);
    expect(primaries(out)).toEqual([]);
  });

  it("цена принята — «Открыть сделку», адрес сделки (указал покупатель) открыт после заключения оферты; заявка отменена — причина, переписка остаётся", async () => {
    const { client, requestId } = await buyerRequest();
    const executor = await master();
    const { offerId } = await sendOffer(executor, offerInput(requestId, 500_000));
    const { dealId } = await acceptPrice(client, { proposalId: (await openProposal(offerId)).id });
    await setDealAddress(client, dealId, { address: ADDRESS });
    // Адрес — только после заключения оферты (ADR-016).
    expect(text(await render(requestId))).not.toContain(ADDRESS);
    await db.deal.update({ where: { id: dealId }, data: { signedAt: new Date() } });
    const out = await render(requestId);
    expect(primaries(out)).toEqual([t.actions.openDeal]);
    expect(out).toContain(`href="/v2/deals/${dealId}"`);
    expect(text(out)).toContain(ADDRESS);
    expect(text(out)).toContain(t.now.deal.next);
    expect(text(out)).toContain(t.request.contactsDeal);

    const other = await buyerRequest(false);
    const second = await sendOffer(executor, offerInput(other.requestId, 300_000));
    await cancelRequest(other.client, { requestId: other.requestId });
    const cancelled = await render(other.requestId);
    expect(text(cancelled)).toContain(t.now.requestCancelled.title);
    expect(cancelled).toContain(`href="/v2/chats/${second.offerId}"`);
    expect(text(cancelled)).toContain(t.actions.chatClosed);
    expect(text(cancelled)).not.toContain(t.actions.chat);
    // Договориться уже нельзя: строки о контактах нет.
    expect(text(cancelled)).not.toContain(t.request.contacts);
    expect(primaries(cancelled)).toEqual([]);
  });
});

describe("заявка мастера: доступ", () => {
  const notFound = { digest: expect.stringContaining("404") };

  it("чужая (не видна мастеру и своего предложения нет) и несуществующая — 404", async () => {
    const client = await makeClient();
    const requestId = await makeOpenRequest(client, { segment: "PREMIUM" });
    await master({ segment: "ECONOMY" });
    await expect(render(requestId)).rejects.toMatchObject(notFound);
    await expect(render("no-such-request")).rejects.toMatchObject(notFound);
  });

  it("неодобренный мастер — экран статуса со ссылкой на регистрацию, а не ошибка", async () => {
    const { requestId } = await buyerRequest();
    await master({ segment: "COMFORT", status: "PENDING" });
    const out = await render(requestId);
    expect(out).toContain(ru.app.masterRequests.gate.pending.now);
    expect(out).toContain('href="/v2/register/executor"');
    expect(count(out, "<h1")).toBe(1);
    // «Назад» вложенного экрана — на главную мастера до одобрения (регистрация и статус): заявки закрыты.
    expect(out).toMatch(/<a [^>]*href="\/v2\/register\/executor"[^>]*><svg[^>]*>.*?<\/svg><span class="sr-only">Назад: <\/span>/);
    expect(text(out)).toContain(t.gateBack);
  });

  it("заявка порядка «до оферты» (замер, проект — флаг preContractFlows) — сразу в v1", async () => {
    const { requestId } = await buyerRequest();
    await db.request.update({ where: { id: requestId }, data: { preContractFlow: "EXECUTOR_MEASURE" } });
    await master();
    await expect(render(requestId)).rejects.toMatchObject({ digest: expect.stringContaining(`;/executor/requests/${requestId};`) });
  });
});

describe("заявка мастера: приглашение", () => {
  it.each(["mobile", "desktop"] as const)("%s: приглашён и не ответил — метка «Вас пригласили», «Отказаться от приглашения»; форма и главное действие прежние", async (device) => {
    h.device = device;
    const { client, requestId } = await buyerRequest();
    const executor = await master();
    await inviteExecutor(client, { requestId, publicNumber: executor.executor.publicNumber });
    const out = await render(requestId);
    expect(out).toContain(t.invited);
    expect(out).toContain(t.decline.action);
    expect(primaries(out)).toEqual([t.form.submit]);
    expect(count(out, "<h1")).toBe(1);
  });

  it("не приглашён — ни метки, ни отказа; отказался — метки и отказа больше нет", async () => {
    const { client, requestId } = await buyerRequest();
    const executor = await master();
    const plain = await render(requestId);
    expect(plain).not.toContain(t.invited);
    expect(plain).not.toContain(t.decline.action);

    await inviteExecutor(client, { requestId, publicNumber: executor.executor.publicNumber });
    await declineInvitation(executor, { requestId, reason: "Занят до весны" });
    const out = await render(requestId);
    expect(out).not.toContain(t.invited);
    expect(out).not.toContain(t.decline.action);
  });

  it("ответил предложением — метка осталась, отказа нет", async () => {
    const { client, requestId } = await buyerRequest();
    const executor = await master();
    await inviteExecutor(client, { requestId, publicNumber: executor.executor.publicNumber });
    await sendOffer(executor, offerInput(requestId));
    const out = await render(requestId);
    expect(out).toContain(t.invited);
    expect(out).not.toContain(t.decline.action);
  });
});
