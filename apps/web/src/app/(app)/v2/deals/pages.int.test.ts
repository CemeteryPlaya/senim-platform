import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { formatMoney } from "@/kit";
import { ru } from "@/i18n/ru";
import { cancelDeal, leaveReview, openDispute, payForDeal, processDealMoney, resolveDispute } from "@/modules/deal-core";
import { db } from "@/platform/db";
import { resetEnvCache } from "@/platform/env";
import { makeClient, makeExecutor, makeOperator } from "../../../../../test/factories";
import { dealAt, makeDeal, signAct, type Executor } from "../../../../../test/factories/deal";
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

  it("ручной провайдер после «Оплатить»: «Переведите 102 000 ₸ по реквизитам из оферты», ссылка на PDF оферты, кнопки нет", async () => {
    const client = await buyer();
    const f = await dealAt("SIGNED", { client, provider: "manual" });
    await payForDeal(client, { dealId: f.dealId });
    const contract = await db.document.findFirstOrThrow({ where: { dealId: f.dealId, kind: "CONTRACT" } });
    await signInAs(client);
    const out = await card(f.dealId);
    expect(plain(out)).toContain(`Переведите ${money(102_000_00n)} по реквизитам из оферты`);
    expect(plain(out)).toContain(now.payTransfer.next);
    expect(out).toContain(`href="/api/documents/${contract.id}/pdf"`);
    expect(plain(out)).toContain(t.card.money.transfer.title);
    expect(plain(out)).not.toContain("не нужно");
    expect(primaries(out)).toEqual([]);
  });

  it("оплата закрыта до согласия мастера для банка: карточка, список и главная говорят одно — ждём мастера, без оранжевого", async () => {
    const client = await buyer();
    const f = await dealAt("SIGNED", { client, bankConsents: [] });
    await signInAs(client);
    const out = await card(f.dealId);
    expect(h2s(out)).toContain(now.payWaitMaster.title);
    expect(primaries(out)).toEqual([]);
    // Своё согласие можно дать заранее — ссылкой на экран оплаты (не главным действием).
    expect(out).toContain(`href="/v2/deals/${f.dealId}/pay"`);
    expect(plain(out)).toContain(now.payWaitMaster.ahead);
    expect(out).not.toContain("bg-warn-soft");
    const listed = await list();
    expect(plain(listed)).toContain(t.status.waitMasterBank);
    expect(plain(listed)).not.toContain(t.status.pay);
    expect(listed).not.toContain("bg-warn-soft");
  });

  it("оплата закрыта, своё согласие уже дано: «Ваше согласие дано, ждём мастера», ссылки на оплату нет", async () => {
    const client = await buyer();
    const f = await dealAt("SIGNED", { client, bankConsents: ["CLIENT"] });
    await signInAs(client);
    const out = await card(f.dealId);
    expect(h2s(out)).toContain(now.payWaitMaster.titleMineGiven);
    expect(out).not.toContain(`href="/v2/deals/${f.dealId}/pay"`);
    expect(plain(out)).not.toContain(now.payWaitMaster.ahead);
    expect(primaries(out)).toEqual([]);
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
    expect(plain(out)).toContain("Зарезервировано");
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
    expect(await card(f.dealId)).not.toContain(t.card.review.section);
    // Отзыв оставлен: кнопки нет, на карточке — «Ваш отзыв» с оценкой и текстом.
    await leaveReview(client, { dealId: f.dealId, rating: 5, text: "Всё сделали в срок" });
    const reviewed = await card(f.dealId);
    expect(primaries(reviewed)).toEqual([]);
    expect(plain(reviewed)).toContain(t.card.review.section);
    expect(plain(reviewed)).toContain(t.card.review.ratingValue(5));
    expect(plain(reviewed)).toContain("Всё сделали в срок");
  });

  it("спор решён разделом: «Спор решён: деньги разделены», шкала остановлена, «Вы оплатили» и «Возвращено вам»", async () => {
    const client = await buyer();
    const f = await dealAt("READY", { client });
    const { disputeId } = await openDispute(client, { dealId: f.dealId, reason: "OTHER", description: "Сделана только часть работ" });
    await resolveDispute(await makeOperator(), { disputeId, outcome: "PARTIAL_SPLIT", masterShareTiyn: "3333333", rationale: "Сделана треть работ" });
    await processDealMoney(f.dealId);
    await signInAs(client);
    const out = await card(f.dealId);
    expect(h2s(out)).toContain(now.disputeSplit.title);
    expect(plain(out)).toContain(t.card.steps.disputeSplit);
    expect(plain(out)).not.toContain(ru.app.deal.allStepsDone);
    expect(plain(out)).toContain(t.card.money.completed.title);
    expect(plain(out)).toContain(t.card.money.refundedRow);
    expect(plain(out)).toContain(money(102_000_00n));
  });

  it("спор решён полным возвратом: «Спор решён: деньги вернулись вам»", async () => {
    const client = await buyer();
    const f = await dealAt("IN_PROGRESS", { client });
    const { disputeId } = await openDispute(client, { dealId: f.dealId, reason: "OTHER", description: "Мастер не выходит на связь" });
    await resolveDispute(await makeOperator(), { disputeId, outcome: "FULL_REFUND", rationale: "Работы не выполнены" });
    await processDealMoney(f.dealId);
    await signInAs(client);
    const out = await card(f.dealId);
    expect(h2s(out)).toContain(now.disputeRefund.done);
    expect(plain(out)).toContain(t.card.money.refunded.done);
  });

  it("спор решён «продолжить»: обычный ход сделки", async () => {
    const client = await buyer();
    const f = await dealAt("IN_PROGRESS", { client });
    const { disputeId } = await openDispute(client, { dealId: f.dealId, reason: "OTHER", description: "Сомнения в сроках работ" });
    await resolveDispute(await makeOperator(), { disputeId, outcome: "CONTINUE", rationale: "Работа идёт по договору" });
    await signInAs(client);
    const out = await card(f.dealId);
    expect(h2s(out)).toContain(now.waitReady.title);
    expect(plain(out)).not.toContain(t.card.steps.disputeSplit);
  });

  it("открытие карточки ничего не пишет: ни выписки, ни событий аудита", async () => {
    const client = await buyer();
    const f = await dealAt("PAID_HOLD", { client });
    await signInAs(client);
    const counts = async () => [await db.document.count({ where: { dealId: f.dealId } }), await db.auditEvent.count({ where: { scope: `deal:${f.dealId}` } })];
    const before = await counts();
    await card(f.dealId);
    await card(f.dealId);
    expect(await counts()).toEqual(before);
  });

  it("история: события словами покупателя, без служебных; «Показать всё» раскрывает", async () => {
    const client = await buyer();
    const f = await dealAt("READY", { client });
    await signInAs(client);
    const short = await card(f.dealId);
    const all = await card(f.dealId, { history: "all" });
    const items = (out: string) => (out.match(/<ol aria-label="События сделки"[\s\S]*?<\/ol>/)?.[0].match(/<li/g) ?? []).length;
    expect(items(short)).toBeLessThanOrEqual(3);
    expect(items(all)).toBeGreaterThanOrEqual(items(short));
    expect(plain(all)).toContain(t.card.history.paid);
    expect(plain(all)).toContain(t.card.history.ready);
    expect(plain(all)).not.toMatch(/Сформирован документ|Банк провёл операцию|Событие по сделке/);
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

  it("мастер этой сделки (активная роль мастера) — карточка мастера в v2", async () => {
    const executor = await makeExecutor();
    await verified(executor.id);
    const f = await dealAt("SIGNED", { executor });
    await signInAs(executor);
    expect(await outcome(() => card(f.dealId))).toBe("page");
    expect(plain(await card(f.dealId))).toContain(ru.app.masterDeal.card.buyer.section);
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
    // После переключения на роль мастера тот же адрес открывает карточку мастера в v2 — петли нет.
    freshBrowser({ "user-agent": "vitest" });
    await signInAs(both, "EXECUTOR");
    expect(await outcome(() => card(f.dealId))).toBe("page");
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

  it("идущие и завершённые: группы чипами, по умолчанию «Идут»; плашка называет шаг («Оплатите заказ»); чужих нет", async () => {
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
    expect(plain(out)).toContain(t.status.pay);
    expect(plain(out)).toContain(ru.common.home.client.inBank);
    expect(primaries(out)).toEqual([]);
    expect(shown(out)).not.toMatch(FORBIDDEN);

    const done = await list({ group: "done" });
    expect(done).toContain(`href="/v2/deals/${cancelled.dealId}"`);
    expect(out).toContain('href="/v2/help#money"');
    expect(out).toContain('href="/v2/help#not-fit"');
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
    // После переключения роли — снова «Сделки» (другой роли).
    expect(out).toContain(`/switch-role?to=EXECUTOR&amp;returnTo=${encodeURIComponent("/v2/deals")}"`);
  });
});

describe("карточка сделки мастера: «что сейчас» и деньги мастера по состояниям на реальной базе", () => {
  const m = ru.app.master.deal;
  const mn = m.now;
  const md = ru.app.masterDeal.card;
  /** Суммы покупателя, которых мастер не видит: оплата с защитой 102 000 ₸ и защита 2 000 ₸. */
  const buyerMoney = (out: string) => [money(102_000_00n), money(2_000_00n)].filter((sum) => plain(out).includes(sum));
  /** Слова покупателя и v1, которых нет у мастера: защита сделки, «2%», «к оплате», «заказчик», «выплата», «договор». */
  const BUYER_WORDS = /Защита сделки|2\s?%|к оплате|заказчик|выплат|договор/i;

  async function master(): Promise<Executor> {
    const executor = await makeExecutor();
    await verified(executor.id);
    return executor;
  }

  it("оферта не подписана: «Подписать оферту» — на экран подписи; контакты покупателя скрыты; «Ждём оплату», «вы получите 96 000 ₸»", async () => {
    const executor = await master();
    const f = await makeDeal({ executor });
    const contract = await db.document.findFirstOrThrow({ where: { dealId: f.dealId, kind: "CONTRACT" } });
    await signInAs(executor);
    const out = await card(f.dealId);
    expect(h2s(out)).toContain(mn.signOffer.title);
    expect(primaries(out)).toEqual([{ href: `/v2/deals/${f.dealId}/sign/${contract.id}`, label: mn.signOffer.action }]);
    expect(plain(out)).toContain(md.money.youGetAfter);
    expect(plain(out)).toContain(md.money.awaiting);
    expect(plain(out)).toContain(md.money.guarantee);
    expect(plain(out)).toContain(money(96_000_00n));
    expect(plain(out)).toContain(md.buyer.hidden);
    expect(out).not.toContain("tel:");
    expect(out).toContain(`href="/v2/chats/${f.offerId}"`);
    expect(plain(out)).toContain(md.buyer.write);
    // Мастер отменяет только до оплаты — меню есть.
    expect(out).toContain(`aria-label="${t.card.actions.menu}"`);
    expect(buyerMoney(out)).toEqual([]);
    expect(shown(out)).not.toMatch(BUYER_WORDS);
    expect(shown(out)).not.toMatch(FORBIDDEN);
  });

  it("оферта заключена, своего согласия для банка нет: «Дать согласие для банка» — на экран оферты; есть — ждём оплату без кнопки", async () => {
    const executor = await master();
    const missing = await dealAt("SIGNED", { executor, bankConsents: ["CLIENT"] });
    const contract = await db.document.findFirstOrThrow({ where: { dealId: missing.dealId, kind: "CONTRACT" }, orderBy: { version: "desc" } });
    await signInAs(executor);
    const out = await card(missing.dealId);
    expect(h2s(out)).toContain(mn.bankConsent.title);
    expect(primaries(out)).toEqual([{ href: `/v2/deals/${missing.dealId}/sign/${contract.id}`, label: mn.bankConsent.action }]);
    expect(plain(out)).toContain(m.status.bankConsent);
    const given = await dealAt("SIGNED", { executor });
    const ok = await card(given.dealId);
    expect(h2s(ok)).toContain(mn.waitPay.title);
    expect(primaries(ok)).toEqual([]);
    // Оферта заключена: контакты покупателя открыты.
    expect(ok).toContain("tel:");
  });

  it("оплачено: «Начать работу» — на экран начала; деньги покупателя в банке под защитой — единственный зелёный блок; сумм покупателя нет", async () => {
    const executor = await master();
    const f = await dealAt("PAID_HOLD", { executor });
    await signInAs(executor);
    const out = await card(f.dealId);
    expect(primaries(out)).toEqual([{ href: `/v2/deals/${f.dealId}/start`, label: mn.start.action }]);
    expect(plain(out)).toContain(md.money.youGetAfter);
    expect(plain(out)).toContain(md.money.protected);
    expect(out).toContain("bg-accent-soft");
    expect(plain(out)).toContain(money(96_000_00n));
    expect(buyerMoney(out)).toEqual([]);
    // После оплаты мастер не отменяет (только покупатель), но спор открыть может — меню есть.
    expect(out).toContain(`aria-label="${t.card.actions.menu}"`);
    expect(shown(out)).not.toMatch(BUYER_WORDS);
  });

  it("идут работы: «Сдать работу», ссылка на отчёт, дата готовности в «Сейчас» (не в «Заказе»); адрес после оферты; ход работ с отчётом", async () => {
    const executor = await master();
    const f = await dealAt("IN_PROGRESS", { executor });
    await db.request.update({ where: { id: f.requestId }, data: { address: "ул. Абая, 12, кв. 5", city: "Астана" } });
    await db.progressReport.create({ data: { dealId: f.dealId, authorId: executor.id, title: "Корпус собран", text: "Осталось навесить фасады" } });
    await signInAs(executor);
    h.device = "desktop";
    const out = await card(f.dealId);
    expect(primaries(out)).toEqual([{ href: `/v2/deals/${f.dealId}/ready`, label: mn.ready.action }]);
    expect(out).toContain(`href="/v2/deals/${f.dealId}/progress"`);
    expect(plain(out)).toContain("Ожидаемая готовность");
    expect(plain(out)).not.toContain(t.card.order.readyBy);
    expect(plain(out)).toContain(md.order.address);
    expect(plain(out)).toContain("ул. Абая, 12, кв. 5");
    expect(plain(out)).toContain(md.reports.section);
    expect(plain(out)).toContain("Корпус собран");
    expect(plain(out)).toContain(m.status.inWork);
  });

  it("до оферты адреса нет, даже если модуль заявок его уже знает", async () => {
    const executor = await master();
    const f = await makeDeal({ executor });
    await db.request.update({ where: { id: f.requestId }, data: { address: "ул. Абая, 12, кв. 5" } });
    await signInAs(executor);
    const out = await card(f.dealId);
    expect(plain(out)).not.toContain("ул. Абая");
    expect(plain(out)).not.toContain(md.order.address);
  });

  it("работа сдана: «Подписать акт» — на экран подписи акта ЭЦП", async () => {
    const executor = await master();
    const f = await dealAt("READY", { executor });
    const act = await db.document.findFirstOrThrow({ where: { dealId: f.dealId, kind: "ACCEPTANCE_ACT" }, orderBy: { version: "desc" } });
    await signInAs(executor);
    const out = await card(f.dealId);
    expect(primaries(out)).toEqual([{ href: `/v2/deals/${f.dealId}/sign/${act.id}`, label: mn.signAct.action }]);
  });

  it("спор: оплата вам приостановлена, кнопки нет, ссылка на позицию; ход остановлен словами мастера", async () => {
    const executor = await master();
    const f = await dealAt("IN_PROGRESS", { executor });
    await openDispute(f.client, { dealId: f.dealId, reason: "OTHER", description: "Сроки сорваны, мебели нет" });
    await signInAs(executor);
    const out = await card(f.dealId);
    expect(h2s(out)).toContain(mn.dispute.title);
    expect(primaries(out)).toEqual([]);
    expect(plain(out)).toContain(md.money.frozen.title);
    expect(plain(out)).toContain(m.stopped.dispute);
    expect(out).toContain(`href="/v2/deals/${f.dealId}/dispute"`);
    expect(buyerMoney(out)).toEqual([]);
  });

  it("завершена: «Вы получили оплату» — его часть из журнала", async () => {
    const executor = await master();
    const f = await dealAt("READY", { executor });
    await signAct(f.dealId);
    await processDealMoney(f.dealId);
    await signInAs(executor);
    const out = await card(f.dealId);
    expect(h2s(out)).toContain(mn.done.title);
    expect(plain(out)).toContain(md.money.completed.done);
    expect(plain(out)).toContain(money(96_000_00n));
    expect(buyerMoney(out)).toEqual([]);
  });

  it("отменена после оплаты: деньги вернулись покупателю, оплаты мастеру нет; сумма возврата покупателя не показывается", async () => {
    const executor = await master();
    const f = await dealAt("PAID_HOLD", { executor });
    await cancelDeal(f.client, { dealId: f.dealId });
    await processDealMoney(f.dealId);
    await signInAs(executor);
    const out = await card(f.dealId);
    expect(h2s(out)).toContain(mn.refunded.title);
    expect(plain(out)).toContain(md.money.refunded.title);
    expect(plain(out)).toContain(md.money.refunded.done);
    expect(buyerMoney(out)).toEqual([]);
    expect(out).not.toContain(`aria-label="${t.card.actions.menu}"`);
  });
});

describe("список «Сделки» мастера", () => {
  const m = ru.app.master.deal;

  it("мастер без сделок: обучающий экран мастера, единственное действие «Открыть заявки»", async () => {
    const executor = await makeExecutor();
    await verified(executor.id);
    await signInAs(executor);
    const out = await list();
    expect(out).toContain(ru.app.masterDeal.list.emptyTitle);
    expect(primaries(out)).toEqual([{ href: "/v2/executor/requests", label: ru.app.masterDeal.list.toRequests }]);
  });

  it("мастер на проверке без сделок — экран статуса, а не пустой список", async () => {
    const executor = await makeExecutor({ status: "PENDING" });
    await verified(executor.id);
    await signInAs(executor);
    const out = await list();
    expect(plain(out)).toContain(ru.app.masterRequests.gate.pending.now);
    expect(primaries(out)).toEqual([{ href: "/v2/register/executor", label: ru.app.masterRequests.gate.pending.action }]);
  });

  it("свои сделки мастера словами мастера; сделки в роли покупателя не смешиваются — ссылка на переключение", async () => {
    const both = await makeExecutor({ roles: ["EXECUTOR", "CLIENT"] });
    await verified(both.id);
    const asMaster = await dealAt("PAID_HOLD", { executor: both });
    const asClient = await dealAt("SIGNED", { client: both });
    await signInAs(both, "EXECUTOR");
    h.device = "desktop";
    const out = await list();
    expect(out).toContain(`href="/v2/deals/${asMaster.dealId}"`);
    expect(out).not.toContain(asClient.dealId);
    expect(plain(out)).toContain(m.status.start);
    expect(plain(out)).toContain(money(96_000_00n));
    expect(plain(out)).not.toContain(money(102_000_00n));
    expect(plain(out)).toContain(ru.app.masterDeal.list.otherRole);
    // После переключения роли — снова «Сделки» (другой роли).
    expect(out).toContain(`/switch-role?to=CLIENT&amp;returnTo=${encodeURIComponent("/v2/deals")}"`);
    expect(out).not.toContain('href="/v2/help#money"');
    expect(shown(out)).not.toMatch(FORBIDDEN);
  });
});
