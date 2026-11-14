import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ru } from "@/i18n/ru";
import { formatMoney } from "@/kit";
import { submitReady } from "@/modules/deal-core";
import { computeDealMoney } from "@/modules/payments";
import { db } from "@/platform/db";
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

  it("от руки подписано — шаг 2 из 2: ЭЦП, способы eGov Mobile и NCALayer, выбран eGov Mobile", async () => {
    const { f, docId } = await contractFixture();
    await signTyped(f.client, docId);
    const out = await render(f.dealId, docId);
    expect(plain(out)).toContain(t.stepOf(2, 2));
    expect(plain(out)).toContain(t.ecp.methods.EGOV_QR.label);
    expect(plain(out)).toContain(t.ecp.methods.NCALAYER.label);
    expect(out).toMatch(/value="EGOV_QR"[^>]*checked|checked[^>]*value="EGOV_QR"/);
    expect(primaries(out)).toHaveLength(1);
    expect(primaries(out)[0]).not.toMatch(/\sdisabled=""/);
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

  it("на компьютере — та же форма в узкой колонке, одно главное действие", async () => {
    const { f, docId } = await contractFixture();
    h.device = "desktop";
    const out = await render(f.dealId, docId);
    expect(out).toContain("max-w-narrow");
    expect(primaries(out)).toHaveLength(1);
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
    expect(plain(out)).not.toContain(t.what.total);
    expect(plain(out)).not.toContain(t.act.farTitle);
    expect(primaries(out)).toHaveLength(1);
    expect(shown(out)).not.toMatch(FORBIDDEN);
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
  it("чужая сделка, документ другой сделки, выписка и несуществующий документ — 404", async () => {
    const { f, docId } = await contractFixture();
    const other = await makeDeal({ client: f.client });
    const otherDoc = await latestDocument(other.dealId, "CONTRACT");
    expect(await outcome(() => render(f.dealId, otherDoc.id))).toMatch(/NEXT_HTTP_ERROR_FALLBACK;404/);
    expect(await outcome(() => render(f.dealId, "no-such-doc"))).toMatch(/NEXT_HTTP_ERROR_FALLBACK;404/);
    await signInAs(await buyer());
    expect(await outcome(() => render(f.dealId, docId))).toMatch(/NEXT_HTTP_ERROR_FALLBACK;404/);
  });

  it("мастер этой сделки и оператор — на карточку сделки v1 (экрана подписи в v1 нет)", async () => {
    const { f, docId } = await contractFixture();
    // Мастер, прошедший первые шаги: иначе ворота уведут его на шаг онбординга раньше развилки ролей.
    await db.user.update({ where: { id: f.executor.id }, data: { emailVerifiedAt: new Date() } });
    await signInAs(f.executor);
    expect(await outcome(() => render(f.dealId, docId))).toEqual(redirectTo(`/deals/${f.dealId}`));
    await signInAs(await makeOperator());
    expect(await outcome(() => render(f.dealId, docId))).toEqual(redirectTo(`/deals/${f.dealId}`));
  });
});
