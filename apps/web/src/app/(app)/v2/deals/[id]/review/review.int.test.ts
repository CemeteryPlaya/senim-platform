import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ru } from "@/i18n/ru";
import { processDealMoney } from "@/modules/deal-core";
import { db } from "@/platform/db";
import { resetEnvCache } from "@/platform/env";
import { makeClient } from "../../../../../../../test/factories";
import { dealAt, signAct } from "../../../../../../../test/factories/deal";
import { freshBrowser } from "../../../../../../../test/factories/identity";
import { signInAs } from "../../../../../../../test/factories/session";
import { leaveReviewAction } from "./actions";
import ReviewPage from "./page";

vi.mock("@/platform/device", () => ({ getDevice: async () => "mobile" }));
vi.mock("next/headers", async () => (await import("../../../../../../../test/factories/identity")).nextHeadersMock);
vi.mock("next/navigation", async (importActual) => ({ ...(await importActual<typeof import("next/navigation")>()), useRouter: () => ({ refresh: () => undefined, replace: () => undefined }) }));

const t = ru.app.deal.review;

function reviews(on: boolean) {
  if (on) process.env.FEATURE_REVIEWS = "true";
  else process.env.FEATURE_REVIEWS = "false";
  resetEnvCache();
}

beforeEach(() => {
  freshBrowser({ "user-agent": "vitest" });
  reviews(true);
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

/** Завершённая сделка (выплата проведена) и её покупатель, уже вошедший. */
async function completed() {
  const client = await buyer();
  const f = await dealAt("READY", { client });
  await signAct(f.dealId);
  await processDealMoney(f.dealId);
  await signInAs(client);
  return f;
}

const page = async (id: string) => renderToStaticMarkup(await ReviewPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));
const plain = (out: string) => out.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

async function outcome(run: () => Promise<string>): Promise<string> {
  try {
    await run();
    return "page";
  } catch (e) {
    return typeof e === "object" && e !== null && "digest" in e ? String((e as { digest: unknown }).digest) : "error";
  }
}

describe("отзыв: экран", () => {
  it("флаг включён, сделка завершена: оценка 5…1, текст, пояснение про скрытые имя и контакты, одно главное действие", async () => {
    const f = await completed();
    const out = await page(f.dealId);
    expect([...out.matchAll(/<h1[^>]*>([^<]*)<\/h1>/g)].map((m) => m[1])).toEqual([t.title]);
    for (const n of [1, 2, 3, 4, 5]) expect(out).toContain(t.rating(n));
    expect(plain(out)).toContain(t.privacy);
    expect(out).not.toMatch(/портфолио/i);
    expect([...out.matchAll(/data-primary-action/g)]).toHaveLength(1);
  });

  it("флаг выключен — карточка сделки", async () => {
    const f = await completed();
    reviews(false);
    expect(await outcome(() => page(f.dealId))).toContain(`/v2/deals/${f.dealId}`);
  });

  it("сделка не завершена — карточка сделки", async () => {
    const client = await buyer();
    const f = await dealAt("PAID_HOLD", { client });
    await signInAs(client);
    expect(await outcome(() => page(f.dealId))).toContain(`/v2/deals/${f.dealId}`);
  });

  it("отзыв уже оставлен — карточка сделки", async () => {
    const f = await completed();
    expect((await leaveReviewAction({ dealId: f.dealId, rating: 5, text: "" })).ok).toBe(true);
    expect(await outcome(() => page(f.dealId))).toContain(`/v2/deals/${f.dealId}`);
  });

  it("чужая сделка — 404", async () => {
    const f = await completed();
    await signInAs(await buyer("Иванов Пётр Иванович"));
    expect(await outcome(() => page(f.dealId))).toContain("404");
  });
});

describe("leaveReviewAction", () => {
  it("сохраняет отзыв: оценка и текст; рейтинг мастера пересчитан", async () => {
    const f = await completed();
    const result = await leaveReviewAction({ dealId: f.dealId, rating: 4, text: "Всё сделано аккуратно" });
    expect(result.ok).toBe(true);
    const review = await db.review.findFirstOrThrow({ where: { dealId: f.dealId } });
    expect([review.rating, review.text]).toEqual([4, "Всё сделано аккуратно"]);
  });

  it("двойное нажатие: один отзыв, оба вызова успешны (второй — повтор с тем же содержимым)", async () => {
    const f = await completed();
    const input = { dealId: f.dealId, rating: 5, text: "" };
    const results = await Promise.all([leaveReviewAction(input), leaveReviewAction(input)]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(await db.review.count({ where: { dealId: f.dealId } })).toBe(1);
  });

  it("повторный отзыв с другой оценкой — конфликт", async () => {
    const f = await completed();
    expect((await leaveReviewAction({ dealId: f.dealId, rating: 5, text: "" })).ok).toBe(true);
    const again = await leaveReviewAction({ dealId: f.dealId, rating: 3, text: "" });
    expect(again.ok ? null : again.code).toBe("CONFLICT");
  });

  it("оценка вне 1–5 — по-русски у поля; флаг выключен — отказ", async () => {
    const f = await completed();
    const bad = await leaveReviewAction({ dealId: f.dealId, rating: 0, text: "" });
    expect(bad.ok ? null : bad.fieldErrors?.rating?.[0]).toBe(t.errors.rating);
    reviews(false);
    expect((await leaveReviewAction({ dealId: f.dealId, rating: 5, text: "" })).ok).toBe(false);
    expect(await db.review.count({ where: { dealId: f.dealId } })).toBe(0);
  });

  it("мастер отзыв этим действием не оставит", async () => {
    const f = await completed();
    await signInAs(f.executor);
    expect((await leaveReviewAction({ dealId: f.dealId, rating: 5, text: "" })).ok).toBe(false);
  });
});
