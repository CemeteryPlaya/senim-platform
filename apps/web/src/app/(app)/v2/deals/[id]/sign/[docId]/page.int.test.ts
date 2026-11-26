import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ru } from "@/i18n/ru";
import { formatMoney } from "@/kit";
import { openDispute, submitReady } from "@/modules/deal-core";
import { createContract, withdrawContract } from "@/modules/documents";
import { computeDealMoney } from "@/modules/payments";
import { db, transaction } from "@/platform/db";
import { makeClient, makeOperator } from "../../../../../../../../test/factories";
import { dealAt, makeDeal, makePhoto, PRICE } from "../../../../../../../../test/factories/deal";
import { latestDocument, signEcp, signTyped, useDocuments } from "../../../../../../../../test/factories/documents";
import { freshBrowser } from "../../../../../../../../test/factories/identity";
import { signInAs } from "../../../../../../../../test/factories/session";
import SignPage from "./page";

const h = vi.hoisted(() => ({ device: "mobile" as "mobile" | "desktop" }));
vi.mock("@/platform/device", () => ({ getDevice: async () => h.device }));
vi.mock("next/headers", async () => (await import("../../../../../../../../test/factories/identity")).nextHeadersMock);
// Клиентские части берут роутер приложения, которого в статическом рендере нет; notFound и redirect — настоящие.
vi.mock("next/navigation", async (importActual) => ({ ...(await importActual<typeof import("next/navigation")>()), useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));

const t = ru.app.deal.sign;
const FORBIDDEN = /комисси|эскроу|тестов|демо|платформ|отклик/i;

let cleanup: () => Promise<void>;
beforeAll(async () => {
  cleanup = await useDocuments();
});
afterAll(() => cleanup());
beforeEach(() => {
  freshBrowser({ "user-agent": "vitest" });
  h.device = "mobile";
});

/** Покупатель, прошедший первые шаги (почта подтверждена). */
async function buyer() {
  const client = await makeClient("Сапарова Айгерим Ержановна");
  await db.user.update({ where: { id: client.id }, data: { emailVerifiedAt: new Date() } });
  return client;
}

const render = async (id: string, docId: string) => renderToStaticMarkup(await SignPage({ params: Promise.resolve({ id, docId }), searchParams: Promise.resolve({}) }));

/** Исход вызова страницы: «page», адрес перехода или код ошибки Next (digest). */
async function outcome(run: () => Promise<string>): Promise<string> {
  try {
    await run();
    return "page";
  } catch (e) {
    const digest = typeof e === "object" && e !== null && "digest" in e ? String((e as { digest: unknown }).digest) : "";
    return digest || "error";
  }
}
const redirectTo = (href: string) => expect.stringMatching(new RegExp(`^NEXT_REDIRECT;[a-z]+;${href.replace(/[/?]/g, "\\$&")};`));

const plain = (out: string) => out.replace(/<[^>]*>/g, " ").replace(/&nbsp;| | /g, " ");
const money = (tiyn: bigint) => formatMoney(tiyn).replace(/[  ]/g, " ");
/** Видимый текст без названия заказа фабрики («Тестовый заказ» — данные теста). */
const shown = (out: string) => plain(out).replaceAll("Тестовый заказ", "");
const primaries = (out: string) => [...out.matchAll(/<button[^>]*data-primary-action[^>]*>/g)].map((m) => m[0]);

async function contractFixture() {
  const client = await buyer();
  const f = await makeDeal({ client });
  const doc = await latestDocument(f.dealId, "CONTRACT");
  await signInAs(client);
  return { f, docId: doc.id };
}

describe("экран подписи оферты", () => {
  it("шаг 1 из 2 — от руки: «Что вы подписываете» с суммами модуля, PDF в новой вкладке, одно главное «Подписать» (отключено, причина рядом)", async () => {
    const { f, docId } = await contractFixture();
    const out = await render(f.dealId, docId);
    const m = computeDealMoney(PRICE);
    expect(out.match(/<h1/g)).toHaveLength(1);
    expect(out).toContain(`>${t.title.CONTRACT}<`);
    expect(out).toContain(`href="/v2/deals/${f.dealId}"`);
    expect(plain(out)).toContain(t.what.section);
    expect(plain(out)).toContain(money(m.priceTiyn));
    expect(plain(out)).toContain(money(m.buyerTotalTiyn));
    expect(out).toContain(`href="/api/documents/${docId}/pdf"`);
    expect(out).toMatch(/target="_blank"/);
    expect(plain(out)).toContain(t.stepOf(1, 2));
    expect(plain(out)).toContain(t.hand.section);
    expect(primaries(out)).toHaveLength(1);
    expect(primaries(out)[0]).toMatch(/\sdisabled=""/);
    expect(plain(out)).toContain(t.hand.empty);
    expect(shown(out)).not.toMatch(FORBIDDEN);
  });

  it("шаг 1 — понятная строка: «Шаг 1 из 2: подпись от руки. Затем — электронная подпись (ЭЦП)»", async () => {
    const { f, docId } = await contractFixture();
    expect(plain(await render(f.dealId, docId))).toContain(t.steps.handFirst);
  });

  it("от руки подписано — «Шаг 2 из 2: электронная подпись»; на компьютере — eGov Mobile (выбран) и ключ NCALayer", async () => {
    const { f, docId } = await contractFixture();
    await signTyped(f.client, docId);
    h.device = "desktop";
    const out = await render(f.dealId, docId);
    expect(plain(out)).toContain(t.steps.ecpSecond);
    expect(plain(out)).toContain(t.ecp.methods.EGOV_QR.label);
    expect(plain(out)).toContain(t.ecp.methods.NCALAYER.label);
    expect(out).toMatch(/value="EGOV_QR"[^>]*checked|checked[^>]*value="EGOV_QR"/);
    expect(primaries(out)).toHaveLength(1);
    expect(primaries(out)[0]).not.toMatch(/\sdisabled=""/);
  });

  it("на телефоне ключ ЭЦП на компьютере (NCALayer) не предлагается: только eGov Mobile", async () => {
    const { f, docId } = await contractFixture();
    await signTyped(f.client, docId);
    const out = await render(f.dealId, docId);
    expect(plain(out)).toContain(t.ecp.phoneMethod);
    expect(plain(out)).not.toContain(t.ecp.methods.NCALAYER.label);
    expect(out).not.toContain('value="NCALAYER"');
    expect(primaries(out)).toHaveLength(1);
  });

  it("заменённая редакция оферты (старая ссылка) — на карточку сделки; действующая редакция — экран подписи", async () => {
    const { f, docId } = await contractFixture();
    await transaction((tx) => withdrawContract(tx, f.dealId));
    await transaction((tx) => createContract(tx, f.dealId));
    const fresh = await latestDocument(f.dealId, "CONTRACT");
    expect(fresh.id).not.toBe(docId);
    expect((await db.document.findUniqueOrThrow({ where: { id: docId } })).status).toBe("SUPERSEDED");
    expect(await outcome(() => render(f.dealId, docId))).toEqual(redirectTo(`/v2/deals/${f.dealId}`));
    expect(await outcome(() => render(f.dealId, fresh.id))).toBe("page");
  });

  it("всё своё подписано, оферта уже заключена — на карточку сделки без ошибки", async () => {
    const { f, docId } = await contractFixture();
    await signTyped(f.client, docId);
    await signEcp(f.client, docId);
    expect(await outcome(() => render(f.dealId, docId))).toEqual(redirectTo(`/v2/deals/${f.dealId}`));
    const done = await dealAt("SIGNED", { client: f.client });
    const contract = await latestDocument(done.dealId, "CONTRACT");
    expect(await outcome(() => render(done.dealId, contract.id))).toEqual(redirectTo(`/v2/deals/${done.dealId}`));
  });

  it("на компьютере — две колонки: слева подпись и кнопка «Подписать оферту», справа «Что вы подписываете»; одно главное действие", async () => {
    const { f, docId } = await contractFixture();
    h.device = "desktop";
    const out = await render(f.dealId, docId);
    expect(out).toContain("desktop:grid-cols-split");
    expect(primaries(out)).toHaveLength(1);
    // Подпись (слева) идёт в разметке раньше «Что вы подписываете» (справа).
    expect(out.indexOf(ru.app.deal.sign.hand.section)).toBeLessThan(out.indexOf(ru.app.deal.sign.what.section));
    expect(out).toContain(ru.app.deal.sign.hand.submit.CONTRACT);
  });
});

describe("экран подписи акта приёмки", () => {
  async function actFixture(far: boolean) {
    const client = await buyer();
    const f = await dealAt("IN_PROGRESS", { client });
    // «Далеко» — около 5 км к северу от адреса заказа фабрики (Байтерек).
    const point = far ? { lat: 51.175, lng: 71.430411 } : { lat: 51.128207, lng: 71.430411 };
    await submitReady(f.executor, { dealId: f.dealId, photoIds: [await makePhoto(f.executor)], ...point, accuracyM: 10 });
    const act = await latestDocument(f.dealId, "ACCEPTANCE_ACT");
    await signInAs(client);
    return { f, docId: act.id };
  }

  it("«Примите мебель: подпишите акт»: что значит подпись, без суммы к оплате; у адреса — без предупреждения", async () => {
    const { f, docId } = await actFixture(false);
    const out = await render(f.dealId, docId);
    expect(out).toContain(`>${t.title.ACCEPTANCE_ACT}<`);
    expect(plain(out)).toContain(t.act.meaning);
    expect(plain(out)).toContain(t.act.notLiked);
    expect(plain(out)).not.toContain(t.what.priceTotal);
    expect(plain(out)).not.toContain(t.act.farTitle);
    expect(primaries(out)).toHaveLength(1);
    expect(shown(out)).not.toMatch(FORBIDDEN);
  });

  it("открытие экрана ничего не пишет: выписка по деньгам не выпускается", async () => {
    const { f, docId } = await actFixture(false);
    const statements = () => db.document.count({ where: { dealId: f.dealId, kind: "MONEY_STATEMENT" } });
    const before = await statements();
    await render(f.dealId, docId);
    expect(await statements()).toBe(before);
  });

  it("открыт спор — подписывать акт сейчас нельзя: на карточку сделки", async () => {
    const { f, docId } = await actFixture(false);
    await openDispute(f.client, { dealId: f.dealId, reason: "OTHER", description: "Дверца не закрывается до конца" });
    expect(await outcome(() => render(f.dealId, docId))).toEqual(redirectTo(`/v2/deals/${f.dealId}`));
  });

  it("сдано дальше радиуса — предупреждение о расстоянии из данных модуля", async () => {
    const { f, docId } = await actFixture(true);
    const deal = await db.deal.findUniqueOrThrow({ where: { id: f.dealId } });
    expect(deal.readyWithinRadius).toBe(false);
    const out = await render(f.dealId, docId);
    expect(plain(out)).toContain(t.act.farTitle);
    expect(plain(out)).toContain(`${deal.readyDistanceM} м от адреса заказа`);
  });
});

describe("ворота экрана подписи", () => {
  it("чужая сделка — 404; в своей сделке документа нет среди действующих — карточка своей сделки (один ответ для любого id)", async () => {
    const { f, docId } = await contractFixture();
    const other = await makeDeal({ client: f.client });
    const otherDoc = await latestDocument(other.dealId, "CONTRACT");
    expect(await outcome(() => render(f.dealId, otherDoc.id))).toEqual(redirectTo(`/v2/deals/${f.dealId}`));
    expect(await outcome(() => render(f.dealId, "no-such-doc"))).toEqual(redirectTo(`/v2/deals/${f.dealId}`));
    await signInAs(await buyer());
    expect(await outcome(() => render(f.dealId, docId))).toMatch(/NEXT_HTTP_ERROR_FALLBACK;404/);
    expect(await outcome(() => render("no-such-deal", docId))).toMatch(/NEXT_HTTP_ERROR_FALLBACK;404/);
  });

  it("оператор — на свою карточку сделки v2: подписывают только стороны", async () => {
    const { f, docId } = await contractFixture();
    await signInAs(await makeOperator());
    expect(await outcome(() => render(f.dealId, docId))).toEqual(redirectTo(`/v2/operator/deals/${f.dealId}`));
  });
});

describe("экран подписи мастера", () => {
  const tm = ru.app.masterSteps.sign;
  const m = computeDealMoney(PRICE);

  /** Мастер сделки, прошедший первые шаги (почта подтверждена): иначе ворота уведут его на шаг онбординга. */
  async function asMaster(f: { executor: { id: string } }) {
    await db.user.update({ where: { id: f.executor.id }, data: { emailVerifiedAt: new Date() } });
    await signInAs(f.executor);
  }

  async function masterContract(bankConsents: readonly ("CLIENT" | "EXECUTOR")[]) {
    const f = await makeDeal({ bankConsents });
    const doc = await latestDocument(f.dealId, "CONTRACT");
    await asMaster(f);
    return { f, docId: doc.id };
  }

  /** Суммы покупателя (защита сделки 2% и к оплате) — их в HTML мастера нет. */
  // С ADR-015 сумма покупателя равна цене по оферте (её мастер видит): скрыта только строка «к оплате» покупателя.
  function noBuyerSums(out: string) {
    expect(m.buyerTotalTiyn).toBe(m.priceTiyn);
    expect(plain(out)).not.toContain(t.what.priceTotal);
    expect(plain(out)).not.toMatch(/Защита сделки/);
  }

  it("оферта, согласия нет: текст согласия с прокруткой и отметка над подписью; «Подписать оферту» отключена с объяснением; суммы мастера", async () => {
    const { f, docId } = await masterContract(["CLIENT"]);
    const out = await render(f.dealId, docId);
    expect(out.match(/<h1/g)).toHaveLength(1);
    expect(out).toContain(`>${tm.title.CONTRACT}<`);
    expect(out).toContain(`aria-label="${ru.app.deal.pay.consent.textLabel}"`);
    expect(plain(out)).toContain(tm.consent.agree);
    expect(out).toMatch(/type="checkbox"[^>]*name="agreed"|name="agreed"[^>]*type="checkbox"/);
    expect(primaries(out)).toHaveLength(1);
    expect(primaries(out)[0]).toMatch(/\sdisabled=""/);
    expect(plain(out)).toContain(tm.consent.lockedHand);
    expect(plain(out)).toContain(t.hand.section);
    expect(plain(out)).toContain(tm.what.youGet);
    expect(plain(out)).toContain(money(m.payoutTiyn));
    expect(plain(out)).toContain(tm.what.guarantee);
    noBuyerSums(out);
    expect(shown(out)).not.toMatch(FORBIDDEN);
  });

  it("оферта, согласие уже дано: «Согласие для банка дано», отметки нет; кнопка ждёт только подпись", async () => {
    const { f, docId } = await masterContract(["CLIENT", "EXECUTOR"]);
    const out = await render(f.dealId, docId);
    expect(plain(out)).toContain(tm.consent.given);
    expect(out).not.toContain('name="agreed"');
    expect(plain(out)).toContain(t.hand.empty);
    expect(plain(out)).not.toContain(tm.consent.locked);
    noBuyerSums(out);
  });

  it("оферта от руки подписана — шаг 2 ЭЦП; на компьютере — две колонки, одно главное действие", async () => {
    const { f, docId } = await masterContract(["CLIENT", "EXECUTOR"]);
    await signTyped(f.executor, docId);
    h.device = "desktop";
    const out = await render(f.dealId, docId);
    expect(plain(out)).toContain(t.steps.ecpSecond);
    expect(out).toContain("desktop:grid-cols-split");
    expect(primaries(out)).toHaveLength(1);
    expect(primaries(out)[0]).not.toMatch(/\sdisabled=""/);
  });

  it("Ruling 7: оферта подписана, своего согласия нет — экран согласия с единственным действием «Дать согласие»", async () => {
    const f = await dealAt("SIGNED", { bankConsents: ["CLIENT"] });
    const contract = await latestDocument(f.dealId, "CONTRACT");
    await asMaster(f);
    const out = await render(f.dealId, contract.id);
    expect(out).toContain(`>${tm.consentTitle}<`);
    expect(plain(out)).toContain(tm.consent.now.title);
    expect(primaries(out)).toHaveLength(1);
    expect(primaries(out)[0]).not.toMatch(/\sdisabled=""/);
    expect(out).toContain(tm.consent.give);
    expect(plain(out)).not.toContain(t.hand.section);
    noBuyerSums(out);
  });

  it("оферта подписана и согласие дано — подписывать нечего: на карточку сделки", async () => {
    const f = await dealAt("SIGNED");
    const contract = await latestDocument(f.dealId, "CONTRACT");
    await asMaster(f);
    expect(await outcome(() => render(f.dealId, contract.id))).toEqual(redirectTo(`/v2/deals/${f.dealId}`));
  });

  it("акт: «Подпишите акт приёмки», что значит подпись для мастера, только ЭЦП; сдано далеко — свой текст о расстоянии", async () => {
    const f = await dealAt("IN_PROGRESS");
    await submitReady(f.executor, { dealId: f.dealId, photoIds: [await makePhoto(f.executor)], lat: 51.175, lng: 71.430411, accuracyM: 10 });
    const act = await latestDocument(f.dealId, "ACCEPTANCE_ACT");
    await asMaster(f);
    const out = await render(f.dealId, act.id);
    const deal = await db.deal.findUniqueOrThrow({ where: { id: f.dealId } });
    expect(out).toContain(`>${tm.title.ACCEPTANCE_ACT}<`);
    expect(plain(out)).toContain(tm.act.meaning);
    expect(plain(out)).not.toContain(t.act.notLiked);
    expect(plain(out)).toContain(t.ecp.section);
    expect(plain(out)).not.toContain(t.hand.section);
    expect(deal.readyWithinRadius).toBe(false);
    expect(plain(out)).toContain(tm.act.farTitle);
    expect(plain(out)).toContain(`Вы отметили сдачу в ${deal.readyDistanceM} м от адреса заказа`);
    expect(primaries(out)).toHaveLength(1);
    noBuyerSums(out);
  });
});
