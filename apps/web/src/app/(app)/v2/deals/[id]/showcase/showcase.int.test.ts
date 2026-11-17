import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ru } from "@/i18n/ru";
import { processDealMoney, SHOWCASE_TEXT_VERSION } from "@/modules/deal-core";
import { db } from "@/platform/db";
import { resetEnvCache } from "@/platform/env";
import { makeClient } from "../../../../../../../test/factories";
import { dealAt, signAct } from "../../../../../../../test/factories/deal";
import { freshBrowser } from "../../../../../../../test/factories/identity";
import { signInAs } from "../../../../../../../test/factories/session";
import DealPage from "../(card)/page";
import { leaveReviewAction } from "../review/actions";
import ReviewPage from "../review/page";
import { saveShowcaseAction } from "./actions";
import ShowcasePage from "./page";

vi.mock("@/platform/device", () => ({ getDevice: async () => "mobile" }));
vi.mock("next/headers", async () => (await import("../../../../../../../test/factories/identity")).nextHeadersMock);
vi.mock("next/navigation", async (importActual) => ({ ...(await importActual<typeof import("next/navigation")>()), useRouter: () => ({ refresh: () => undefined, replace: () => undefined, push: () => undefined }) }));

const t = ru.app.deal.showcase;
const KEY = "5b6f3c0e-8d1a-4c52-9f0e-1a2b3c4d5e6f";

beforeEach(() => {
  freshBrowser({ "user-agent": "vitest" });
  process.env.FEATURE_REVIEWS = "true";
  resetEnvCache();
});
afterEach(() => {
  delete process.env.FEATURE_REVIEWS;
  resetEnvCache();
});

async function buyer(name = "Сапаров Ерлан Ержанович") {
  const client = await makeClient(name);
  await db.user.update({ where: { id: client.id }, data: { emailVerifiedAt: new Date() } });
  return client;
}

/** Оконченная сделка с офертой (выплата проведена) и её покупатель, уже вошедший. */
async function completed() {
  const client = await buyer();
  const f = await dealAt("READY", { client });
  await signAct(f.dealId);
  await processDealMoney(f.dealId);
  await signInAs(client);
  return f;
}

async function place(dealId: string, where: { district: string | null; complex: string | null }) {
  const deal = await db.deal.findUniqueOrThrow({ where: { id: dealId }, select: { requestId: true } });
  await db.request.update({ where: { id: deal.requestId }, data: where });
}

const choice = (dealId: string) => ({ dealId, photos: true, price: false, address: "CITY", signature: "NAME" }) as const;
const showcasePage = async (id: string) => renderToStaticMarkup(await ShowcasePage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));
const reviewPage = async (id: string) => renderToStaticMarkup(await ReviewPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));
const cardPage = async (id: string) => renderToStaticMarkup(await DealPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));
const plain = (out: string) => out.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
const radioValues = (out: string) => [...out.matchAll(/<input[^>]*name="address"[^>]*value="([A-Z]+)"/g)].map((m) => m[1]);

async function outcome(run: () => Promise<string>): Promise<string> {
  try {
    await run();
    return "page";
  } catch (e) {
    return typeof e === "object" && e !== null && "digest" in e ? String((e as { digest: unknown }).digest) : "error";
  }
}

describe("saveShowcaseAction", () => {
  it("покупатель сохраняет выбор; повтор — без второй записи в журнале", async () => {
    const f = await completed();
    expect((await saveShowcaseAction(choice(f.dealId))).ok).toBe(true);
    expect(await db.dealShowcase.findUniqueOrThrow({ where: { dealId: f.dealId } })).toMatchObject({ photos: true, price: false, address: "CITY", signature: "NAME", textVersion: SHOWCASE_TEXT_VERSION });
    expect((await saveShowcaseAction({ ...choice(f.dealId), clientKey: KEY })).ok).toBe(true);
    expect(await db.auditEvent.count({ where: { entityId: f.dealId, action: "deal.showcase.changed" } })).toBe(1);
  });

  it("мастер сделки — FORBIDDEN, выбор не записан", async () => {
    const f = await completed();
    await signInAs(f.executor);
    const result = await saveShowcaseAction(choice(f.dealId));
    expect(result.ok ? null : result.code).toBe("FORBIDDEN");
    expect(await db.dealShowcase.count({ where: { dealId: f.dealId } })).toBe(0);
  });

  it("адрес, которого нет в заявке (район), — отказ", async () => {
    const f = await completed();
    await place(f.dealId, { district: null, complex: null });
    expect((await saveShowcaseAction({ ...choice(f.dealId), address: "DISTRICT" })).ok).toBe(false);
  });
});

describe("страница выбора", () => {
  it("варианты адреса — только доступные: без района — не показывать и город", async () => {
    const f = await completed();
    await place(f.dealId, { district: null, complex: null });
    const out = await showcasePage(f.dealId);
    expect(radioValues(out)).toEqual(["NONE", "CITY"]);
    expect([...out.matchAll(/<h1[^>]*>([^<]*)<\/h1>/g)].map((m) => m[1])).toEqual([t.title]);
    expect([...out.matchAll(/data-primary-action/g)]).toHaveLength(1);
  });

  it("район и ЖК есть — все четыре варианта", async () => {
    const f = await completed();
    await place(f.dealId, { district: "Алмалинский", complex: "Нурлы Тау" });
    expect(radioValues(await showcasePage(f.dealId))).toEqual(["NONE", "CITY", "DISTRICT", "COMPLEX"]);
  });

  it("сделка не окончена — карточка сделки; чужая — 404", async () => {
    const client = await buyer();
    const open = await dealAt("PAID_HOLD", { client });
    await signInAs(client);
    expect(await outcome(() => showcasePage(open.dealId))).toContain(`/v2/deals/${open.dealId}`);
    const f = await completed();
    await signInAs(await buyer("Иванов Пётр Иванович"));
    expect(await outcome(() => showcasePage(f.dealId))).toContain("404");
  });
});

describe("отзыв и выбор одной отправкой", () => {
  it("пишет и отзыв, и выбор; повтор с тем же ключом — без второй записи и без ошибки", async () => {
    const f = await completed();
    const input = { dealId: f.dealId, rating: 5, text: "Отлично", showcase: { photos: true, price: true, address: "CITY", signature: "INITIAL" }, clientKey: KEY } as const;
    expect((await leaveReviewAction(input)).ok).toBe(true);
    expect((await leaveReviewAction(input)).ok).toBe(true);
    expect(await db.review.count({ where: { dealId: f.dealId } })).toBe(1);
    expect(await db.dealShowcase.findUniqueOrThrow({ where: { dealId: f.dealId } })).toMatchObject({ photos: true, price: true, address: "CITY", signature: "INITIAL" });
    expect(await db.auditEvent.count({ where: { entityId: f.dealId, action: "deal.showcase.changed" } })).toBe(1);
  });

  it("повтор после обрыва между отзывом и выбором: выбор всё же сохранён", async () => {
    const f = await completed();
    expect((await leaveReviewAction({ dealId: f.dealId, rating: 4, text: "" })).ok).toBe(true);
    const input = { dealId: f.dealId, rating: 4, text: "", showcase: { photos: false, price: false, address: "NONE", signature: "INITIAL" }, clientKey: KEY } as const;
    expect((await leaveReviewAction(input)).ok).toBe(true);
    expect(await db.review.count({ where: { dealId: f.dealId } })).toBe(1);
    expect(await db.dealShowcase.count({ where: { dealId: f.dealId } })).toBe(1);
  });

  it("повтор с тем же содержимым без ключа — успех: отзыв один, выбор сохранён", async () => {
    const f = await completed();
    expect((await leaveReviewAction({ dealId: f.dealId, rating: 4, text: "Хорошо" })).ok).toBe(true);
    const input = { dealId: f.dealId, rating: 4, text: "  Хорошо ", showcase: { photos: true, price: false, address: "CITY", signature: "INITIAL" }, clientKey: KEY } as const;
    expect((await leaveReviewAction(input)).ok).toBe(true);
    expect(await db.review.count({ where: { dealId: f.dealId } })).toBe(1);
    expect(await db.dealShowcase.findUniqueOrThrow({ where: { dealId: f.dealId } })).toMatchObject({ photos: true, address: "CITY" });
  });

  it("повтор с другой оценкой — отказ: оценка прежняя, выбор не записан", async () => {
    const f = await completed();
    expect((await leaveReviewAction({ dealId: f.dealId, rating: 4, text: "Хорошо" })).ok).toBe(true);
    const again = await leaveReviewAction({ dealId: f.dealId, rating: 2, text: "Хорошо", showcase: { photos: true, price: true, address: "CITY", signature: "NAME" }, clientKey: KEY });
    expect(again.ok ? null : again.code).toBe("CONFLICT");
    expect((await db.review.findFirstOrThrow({ where: { dealId: f.dealId } })).rating).toBe(4);
    expect(await db.dealShowcase.count({ where: { dealId: f.dealId } })).toBe(0);
  });

  it("повтор с другим текстом — отказ: текст прежний, выбор не записан", async () => {
    const f = await completed();
    expect((await leaveReviewAction({ dealId: f.dealId, rating: 4, text: "Хорошо" })).ok).toBe(true);
    const again = await leaveReviewAction({ dealId: f.dealId, rating: 4, text: "Совсем другое", showcase: { photos: true, price: true, address: "CITY", signature: "NAME" }, clientKey: KEY });
    expect(again.ok ? null : again.code).toBe("CONFLICT");
    expect((await db.review.findFirstOrThrow({ where: { dealId: f.dealId } })).text).toBe("Хорошо");
    expect(await db.dealShowcase.count({ where: { dealId: f.dealId } })).toBe(0);
  });

  it("экран отзыва: под оценкой тот же выбор", async () => {
    const f = await completed();
    const out = await reviewPage(f.dealId);
    expect(plain(out)).toContain(t.photos);
    expect(radioValues(out)).toContain("CITY");
    expect([...out.matchAll(/data-primary-action/g)]).toHaveLength(1);
  });
});

describe("карточка сделки: строка показа", () => {
  it("покупателю оконченной сделки — одна строка с выбором и «Изменить»", async () => {
    const f = await completed();
    expect(plain(await cardPage(f.dealId))).toContain(t.line(t.summary.unanswered));
    expect((await saveShowcaseAction(choice(f.dealId))).ok).toBe(true);
    const out = await cardPage(f.dealId);
    expect(plain(out)).toContain(t.line(t.summary.of({ photos: true, price: false, address: "CITY", signature: "NAME" })));
    expect(out).toContain(`href="/v2/deals/${f.dealId}/showcase"`);
    expect(plain(out)).toContain(t.change);
  });

  it("у сделки в работе строки нет", async () => {
    const client = await buyer();
    const open = await dealAt("PAID_HOLD", { client });
    await signInAs(client);
    expect(plain(await cardPage(open.dealId))).not.toContain(t.lineLabel);
  });
});
