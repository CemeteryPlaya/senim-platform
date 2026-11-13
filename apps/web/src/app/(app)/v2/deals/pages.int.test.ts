import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { formatMoney } from "@/kit";
import { ru } from "@/i18n/ru";
import { cancelDeal, openDispute, payForDeal, processDealMoney } from "@/modules/deal-core";
import { db } from "@/platform/db";
import { resetEnvCache } from "@/platform/env";
import { makeClient, makeExecutor, makeOperator } from "../../../../../test/factories";
import { dealAt, makeDeal, signAct } from "../../../../../test/factories/deal";
import { freshBrowser } from "../../../../../test/factories/identity";
import { signInAs } from "../../../../../test/factories/session";
import DealPage from "./[id]/page";
import DealsPage from "./page";

const h = vi.hoisted(() => ({ device: "mobile" as "mobile" | "desktop" }));
vi.mock("@/platform/device", () => ({ getDevice: async () => h.device }));
vi.mock("next/headers", async () => (await import("../../../../../test/factories/identity")).nextHeadersMock);
// Клиентское меню берёт роутер приложения, которого в статическом рендере нет; остальное (notFound, redirect) — настоящее.
vi.mock("next/navigation", async (importActual) => ({ ...(await importActual<typeof import("next/navigation")>()), useRouter: () => ({ refresh: () => undefined }) }));

const t = ru.app.deal;
const now = t.card.now;

beforeEach(() => {
  freshBrowser({ "user-agent": "vitest" });
  h.device = "mobile";
});

afterEach(() => {
  delete process.env.FEATURE_REVIEWS;
  resetEnvCache();
});

/** Заказчик, прошедший первые шаги (почта подтверждена). */
async function buyer(fullName = "Сапаров Ерлан Ержанович") {
  const client = await makeClient(fullName);
  await db.user.update({ where: { id: client.id }, data: { emailVerifiedAt: new Date() } });
  return client;
}

const verified = async (id: string) => db.user.update({ where: { id }, data: { emailVerifiedAt: new Date() } });

const card = async (id: string, query: Record<string, string> = {}) =>
  renderToStaticMarkup(await DealPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(query) }));
const list = async (query: Record<string, string> = {}) => renderToStaticMarkup(await DealsPage({ searchParams: Promise.resolve(query) }));

/** Исход вызова страницы: «page», адрес перехода (digest) или код ошибки Next (404). */
async function outcome(run: () => Promise<string>): Promise<string> {
  try {
    await run();
    return "page";
  } catch (e) {
    const digest = typeof e === "object" && e !== null && "digest" in e ? String((e as { digest: unknown }).digest) : "";
    return digest || "error";
  }
}

const primaries = (out: string) => [...out.matchAll(/<a [^>]*data-primary-action[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map((m) => ({ href: m[1], label: m[2] }));
const h2s = (out: string) => [...out.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((m) => m[1]);
const plain = (out: string) => out.replace(/<[^>]*>/g, "").replace(/&nbsp;| | /g, " ");
/** Видимый текст без названия заказа фабрики («Тестовый заказ» — данные теста, а не текст интерфейса). */
const shown = (out: string) => plain(out).replaceAll("Тестовый заказ", "");
const money = (tiyn: bigint) => formatMoney(tiyn).replace(/[  ]/g, " ");
const FORBIDDEN = /комисси|эскроу|тестов|демо|платформ|отклик/i;

describe("карточка сделки покупателя: «что сейчас» по состояниям на реальной базе", () => {
  it("оферта не подписана: «Подписать оферту» — на экран подписи оферты; контакты скрыты; отмена до оплаты", async () => {
    const client = await buyer();
    const f = await makeDeal({ client });
    const contract = await db.document.findFirstOrThrow({ where: { dealId: f.dealId, kind: "CONTRACT" } });
    await signInAs(client);
    const out = await card(f.dealId);
    expect(h2s(out)).toContain(now.signOffer.title);
    expect(primaries(out)).toEqual([{ href: `/v2/deals/${f.dealId}/sign/${contract.id}`, label: now.signOffer.action }]);
    expect(out).toContain(t.card.master.hidden);
    expect(out).not.toContain("tel:");
    expect(out).toContain(`href="/v2/chats/${f.offerId}"`);
    expect(out).toContain(`aria-label="${t.card.actions.menu}"`);
  });

  it("ждём оплату: «Оплатить 102 000 ₸» — на экран оплаты; деньги «К оплате» с «Защита сделки (2%)»; контакты мастера открыты", async () => {
    const client = await buyer();
    const f = await dealAt("SIGNED", { client });
    await db.deal.update({ where: { id: f.dealId }, data: { isDemo: true } });
    await signInAs(client);
    h.device = "desktop";
    const out = await card(f.dealId);
    expect(primaries(out)).toHaveLength(1);
    expect(primaries(out)[0]?.href).toBe(`/v2/deals/${f.dealId}/pay`);
    expect(plain(primaries(out)[0]?.label ?? "")).toBe(`Оплатить ${money(102_000_00n)}`);
    expect(plain(out)).toContain(t.card.money.awaiting.title);
    expect(plain(out)).toContain("Защита сделки (2%)");
    expect(out).toContain("tel:");
    expect(shown(out)).not.toMatch(FORBIDDEN);
  });

  it("оплата ждёт подтверждения (ручной провайдер): «Ждём подтверждения оплаты», кнопки нет", async () => {
    const client = await buyer();
    const f = await dealAt("SIGNED", { client, provider: "manual" });
    await payForDeal(client, { dealId: f.dealId });
    await signInAs(client);
    const out = await card(f.dealId);
    expect(h2s(out)).toContain(now.payPending.title);
    expect(primaries(out)).toEqual([]);
    expect(plain(out)).toContain(t.card.money.pending.title);
  });

  it("оплачено: деньги под защитой (единственный зелёный блок), кнопки нет; меню «Действия» есть", async () => {
    const client = await buyer();
    const f = await dealAt("PAID_HOLD", { client });
    await signInAs(client);
    const out = await card(f.dealId);
    expect(h2s(out)).toContain(now.waitStart.title);
    expect(primaries(out)).toEqual([]);
    expect(plain(out)).toContain("Деньги в банке под защитой");
    expect(out).toContain("bg-accent-soft");
    expect(out).toContain(`aria-label="${t.card.actions.menu}"`);
    expect(shown(out)).not.toMatch(FORBIDDEN);
  });

  it("идут работы: «Мастер изготавливает мебель» с ожидаемой датой", async () => {
    const client = await buyer();
    const f = await dealAt("IN_PROGRESS", { client });
    await signInAs(client);
    const out = await card(f.dealId);
    expect(h2s(out)).toContain(now.waitReady.title);
    expect(plain(out)).toContain("Ожидаемая готовность");
    expect(primaries(out)).toEqual([]);
  });

  it("работа сдана: «Принять мебель» — на экран подписи акта", async () => {
    const client = await buyer();
    const f = await dealAt("READY", { client });
    const act = await db.document.findFirstOrThrow({ where: { dealId: f.dealId, kind: "ACCEPTANCE_ACT" }, orderBy: { version: "desc" } });
    await signInAs(client);
    const out = await card(f.dealId);
    expect(primaries(out)).toEqual([{ href: `/v2/deals/${f.dealId}/sign/${act.id}`, label: now.accept.action }]);
  });

  it("открыт спор: «Спор рассматривает оператор», выплата приостановлена, кнопки нет, ссылка на позицию; ход остановлен", async () => {
    const client = await buyer();
    const f = await dealAt("IN_PROGRESS", { client });
    await openDispute(f.executor, { dealId: f.dealId, reason: "OTHER", description: "Покупатель не пускает на объект" });
    await signInAs(client);
    const out = await card(f.dealId);
    expect(h2s(out)).toContain(now.dispute.title);
    expect(primaries(out)).toEqual([]);
    expect(plain(out)).toContain(t.card.money.frozen.title);
    expect(plain(out)).toContain(ru.app.buyer.home.deal.stopped.dispute);
    expect(out).toContain(`href="/v2/deals/${f.dealId}/dispute"`);
    expect(plain(out)).toContain(t.status.dispute);
  });

  it("отменена до оплаты: «Сделка отменена. Деньги не списывались», меню нет", async () => {
    const client = await buyer();
    const f = await dealAt("SIGNED", { client });
    await cancelDeal(client, { dealId: f.dealId });
    await signInAs(client);
    const out = await card(f.dealId);
    expect(h2s(out)).toContain(now.cancelled.title);
    expect(plain(out)).toContain(now.cancelled.body);
    expect(primaries(out)).toEqual([]);
    expect(out).not.toContain(`aria-label="${t.card.actions.menu}"`);
  });

  it("отменена после оплаты: деньги вернулись на карту целиком", async () => {
    const client = await buyer();
    const f = await dealAt("PAID_HOLD", { client });
    await cancelDeal(client, { dealId: f.dealId });
    await processDealMoney(f.dealId);
    await signInAs(client);
    const out = await card(f.dealId);
    expect((await db.deal.findUniqueOrThrow({ where: { id: f.dealId } })).status).toBe("REFUNDED");
    expect(h2s(out)).toContain(now.refunded.title);
    expect(plain(out)).toContain(t.card.money.refunded.done);
    expect(plain(out)).toContain(money(102_000_00n));
  });

  it("завершена: без отзывов — «Сделка завершена»; с флагом отзывов — «Оставить отзыв»", async () => {
    const client = await buyer();
    const f = await dealAt("READY", { client });
    await signAct(f.dealId);
    await processDealMoney(f.dealId);
    await signInAs(client);
    const done = await card(f.dealId);
    expect(h2s(done)).toContain(now.done.title);
    expect(primaries(done)).toEqual([]);
    expect(plain(done)).toContain(t.card.money.completed.done);
    process.env.FEATURE_REVIEWS = "true";
    resetEnvCache();
    expect(primaries(await card(f.dealId))).toEqual([{ href: `/v2/deals/${f.dealId}/review`, label: now.review.action }]);
  });

  it("история: свёрнута; «Показать всё» раскрывает", async () => {
    const client = await buyer();
    const f = await dealAt("READY", { client });
    await signInAs(client);
    const short = await card(f.dealId);
    const all = await card(f.dealId, { history: "all" });
    const items = (out: string) => (out.match(/<ol aria-label="События сделки"[\s\S]*?<\/ol>/)?.[0].match(/<li/g) ?? []).length;
    expect(items(short)).toBeLessThanOrEqual(5);
    expect(items(all)).toBeGreaterThanOrEqual(items(short));
  });
});

describe("карточка сделки: доступ и роли", () => {
  it("чужая и несуществующая сделка — 404", async () => {
    const f = await dealAt("SIGNED");
    await signInAs(await buyer("Иванов Пётр Иванович"));
    expect(await outcome(() => card(f.dealId))).toContain("404");
    expect(await outcome(() => card("net-takoj-sdelki"))).toContain("404");
  });

  it("гость — на вход с возвратом на сделку", async () => {
    const f = await dealAt("SIGNED");
    const result = await outcome(() => card(f.dealId));
    expect(result).toContain("NEXT_REDIRECT");
    expect(result).toContain(encodeURIComponent(`/v2/deals/${f.dealId}`));
  });

  it("мастер этой сделки (активная роль мастера) — на экран сделки v1", async () => {
    const executor = await makeExecutor();
    await verified(executor.id);
    const f = await dealAt("SIGNED", { executor });
    await signInAs(executor);
    const result = await outcome(() => card(f.dealId));
    expect(result).toContain("NEXT_REDIRECT");
    expect(result).toContain(`;/deals/${f.dealId};`);
  });

  it("оператор — на экран сделки v1", async () => {
    const f = await dealAt("SIGNED");
    await signInAs(await makeOperator());
    expect(await outcome(() => card(f.dealId))).toContain(`;/deals/${f.dealId};`);
  });

  it("человек с двумя ролями: активна роль мастера, а в сделке он покупатель — переключение на роль покупателя", async () => {
    const both = await makeExecutor({ roles: ["EXECUTOR", "CLIENT"] });
    await verified(both.id);
    const f = await dealAt("SIGNED", { client: both });
    await signInAs(both, "EXECUTOR");
    const result = await outcome(() => card(f.dealId));
    expect(result).toContain("/switch-role?to=CLIENT");
    expect(result).toContain(encodeURIComponent(`/v2/deals/${f.dealId}`));
  });

  it("человек с двумя ролями: активна роль покупателя, а в сделке он мастер — переключение на роль мастера", async () => {
    const both = await makeExecutor({ roles: ["EXECUTOR", "CLIENT"] });
    await verified(both.id);
    const f = await dealAt("SIGNED", { executor: both });
    await signInAs(both, "CLIENT");
    expect(await outcome(() => card(f.dealId))).toContain("/switch-role?to=EXECUTOR");
  });
});

describe("список «Сделки»", () => {
  it("новый человек: обучающий экран, единственное действие «Заказать мебель»", async () => {
    await signInAs(await buyer());
    const out = await list();
    expect(out).toContain(t.list.emptyTitle);
    expect(primaries(out)).toEqual([{ href: "/v2/requests/new", label: t.list.order }]);
    expect(out.match(/<h1[^>]*>([^<]*)<\/h1>/)?.[1]).toBe(t.list.title);
  });

  it("идущие и завершённые: группы чипами, по умолчанию «Идут»; признак «нужно ваше действие»; чужих нет", async () => {
    const client = await buyer();
    const pay = await dealAt("SIGNED", { client });
    const running = await dealAt("IN_PROGRESS", { client });
    const cancelled = await dealAt("SIGNED", { client });
    await cancelDeal(client, { dealId: cancelled.dealId });
    const foreign = await dealAt("SIGNED");
    await signInAs(client);
    h.device = "desktop";
    const out = await list();
    expect(plain(out)).toContain(t.list.groups.active(2));
    expect(plain(out)).toContain(t.list.groups.done(1));
    expect(out).toContain(`href="/v2/deals/${pay.dealId}"`);
    expect(out).toContain(`href="/v2/deals/${running.dealId}"`);
    expect(out).not.toContain(`href="/v2/deals/${cancelled.dealId}"`);
    expect(out).not.toContain(foreign.dealId);
    expect(plain(out)).toContain(t.list.mine.pay);
    expect(plain(out)).toContain(ru.common.home.client.inBank);
    expect(primaries(out)).toEqual([]);
    expect(shown(out)).not.toMatch(FORBIDDEN);

    const done = await list({ group: "done" });
    expect(done).toContain(`href="/v2/deals/${cancelled.dealId}"`);
    expect(done).not.toContain(`href="/v2/deals/${pay.dealId}"`);
  });

  it("сделки в роли мастера в список не попадают; есть ссылка на переключение роли", async () => {
    const both = await makeExecutor({ roles: ["EXECUTOR", "CLIENT"] });
    await verified(both.id);
    const asMaster = await dealAt("SIGNED", { executor: both });
    const asClient = await dealAt("SIGNED", { client: both });
    await signInAs(both, "CLIENT");
    const out = await list();
    expect(out).toContain(`href="/v2/deals/${asClient.dealId}"`);
    expect(out).not.toContain(asMaster.dealId);
    expect(plain(out)).toContain(t.list.otherRole);
    expect(out).toContain(`/switch-role?to=EXECUTOR&amp;returnTo=%2Fdeals`);
  });
});
