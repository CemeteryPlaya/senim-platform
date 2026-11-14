import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ru } from "@/i18n/ru";
import { formatMoney } from "@/kit";
import { computeDealMoney } from "@/modules/payments";
import { db } from "@/platform/db";
import { ADDRESS, dealAt, dealOf, makePhoto, PRICE } from "../../../../../../../test/factories/deal";
import { useDocuments } from "../../../../../../../test/factories/documents";
import { freshBrowser } from "../../../../../../../test/factories/identity";
import { signInAs } from "../../../../../../../test/factories/session";
import { submitReadyAction } from "./actions";
import ReadyPage from "./page";

vi.mock("@/platform/device", () => ({ getDevice: async () => "mobile" }));
vi.mock("next/headers", async () => (await import("../../../../../../../test/factories/identity")).nextHeadersMock);
vi.mock("next/navigation", async (importActual) => ({ ...(await importActual<typeof import("next/navigation")>()), useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));

const t = ru.app.masterSteps.ready;

let cleanup: () => Promise<void>;
beforeAll(async () => {
  cleanup = await useDocuments();
});
afterAll(() => cleanup());
beforeEach(() => freshBrowser({ "user-agent": "vitest" }));

const codeOf = (r: { ok: boolean; code?: string }) => (r.ok ? "ok" : r.code);
const acts = (dealId: string) => db.document.count({ where: { dealId, kind: "ACCEPTANCE_ACT" } });
const readyEvents = (dealId: string) => db.auditEvent.count({ where: { scope: `deal:${dealId}`, action: "deal.ready" } });
const render = async (id: string) => renderToStaticMarkup(await ReadyPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));
const plain = (out: string) => out.replace(/<[^>]*>/g, " ").replace(/&nbsp;| | /g, " ");

async function outcome(run: () => Promise<string>): Promise<string> {
  try {
    await run();
    return "page";
  } catch (e) {
    const digest = typeof e === "object" && e !== null && "digest" in e ? String((e as { digest: unknown }).digest) : "";
    return digest || "error";
  }
}

async function working() {
  const f = await dealAt("IN_PROGRESS");
  await signInAs(f.executor);
  return f;
}

describe("submitReadyAction", () => {
  it("без фото — отказ у фото текстом экрана; сделка остаётся в работе, акта нет", async () => {
    const f = await working();
    expect(await submitReadyAction({ dealId: f.dealId, photoIds: [] })).toMatchObject({ ok: false, code: "VALIDATION", fieldErrors: { photoIds: [t.errors.photos] } });
    expect((await dealOf(f.dealId)).status).toBe("IN_PROGRESS");
    expect(await acts(f.dealId)).toBe(0);
  });

  it("геолокация недоступна (без координат) — сдача проходит: READY, акт создан, расстояния нет", async () => {
    const f = await working();
    const r = await submitReadyAction({ dealId: f.dealId, photoIds: [await makePhoto(f.executor)] });
    expect(r).toMatchObject({ ok: true, data: { distanceM: null, withinRadius: null } });
    expect((await dealOf(f.dealId)).status).toBe("READY");
    expect(await acts(f.dealId)).toBe(1);
  });

  it("двойное нажатие (два параллельных вызова) у адреса — одна сдача и один акт, оба ответа — тот же итог", async () => {
    const f = await working();
    const photo = await makePhoto(f.executor);
    const input = { dealId: f.dealId, photoIds: [photo], ...ADDRESS, accuracyM: 12 };
    const results = await Promise.all([submitReadyAction(input), submitReadyAction(input)]);
    expect(results.map(codeOf)).toEqual(["ok", "ok"]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toMatchObject({ ok: true, data: { withinRadius: true } });
    expect(await readyEvents(f.dealId)).toBe(1);
    expect(await acts(f.dealId)).toBe(1);
  });

  it("далеко от адреса (~5 км) — сдача проходит, модуль отвечает «дальше радиуса»", async () => {
    const f = await working();
    const r = await submitReadyAction({ dealId: f.dealId, photoIds: [await makePhoto(f.executor)], lat: 51.175, lng: 71.430411, accuracyM: 10 });
    expect(r).toMatchObject({ ok: true, data: { withinRadius: false } });
    expect(r.ok && r.data.distanceM).toBeGreaterThan(r.ok ? r.data.radiusM : 0);
  });

  it("неполные координаты — ошибка текстом экрана; покупатель этим действием не сдаёт", async () => {
    const f = await working();
    expect(await submitReadyAction({ dealId: f.dealId, photoIds: [await makePhoto(f.executor)], lat: 51.1 })).toMatchObject({ ok: false, code: "VALIDATION", fieldErrors: { lat: [t.errors.coords] } });
    await signInAs(f.client);
    expect((await submitReadyAction({ dealId: f.dealId, photoIds: [await makePhoto(f.client)] })).ok).toBe(false);
    expect((await dealOf(f.dealId)).status).toBe("IN_PROGRESS");
  });
});

describe("экран «Сдать работу»", () => {
  it("мастер, идут работы: фото, место не отмечено (без цифр), «Зачем геолокация?», одно главное действие; сумм покупателя нет", async () => {
    const f = await dealAt("IN_PROGRESS");
    await db.user.update({ where: { id: f.executor.id }, data: { emailVerifiedAt: new Date() } });
    await signInAs(f.executor);
    const out = await render(f.dealId);
    expect(out.match(/<h1/g)).toHaveLength(1);
    expect(plain(out)).toContain(t.photosTitle);
    expect(plain(out)).toContain(t.place.idle);
    expect(out).toContain(t.place.mark);
    expect(out).toContain(t.place.explain.label);
    expect([...out.matchAll(/data-primary-action/g)]).toHaveLength(1);
    expect(out).toContain(t.submit);
    expect(out).toMatch(/capture="environment"/);
    const m = computeDealMoney(PRICE);
    expect(plain(out)).not.toContain(formatMoney(m.buyerTotalTiyn).replace(/[  ]/g, " "));
  });

  it("не шаг сдачи (покупатель; работа уже сдана) — карточка сделки", async () => {
    const f = await dealAt("READY");
    await db.user.update({ where: { id: f.executor.id }, data: { emailVerifiedAt: new Date() } });
    await signInAs(f.executor);
    expect(await outcome(() => render(f.dealId))).toMatch(new RegExp(`^NEXT_REDIRECT;[a-z]+;/v2/deals/${f.dealId};`));
    const g = await dealAt("IN_PROGRESS");
    await db.user.update({ where: { id: g.client.id }, data: { emailVerifiedAt: new Date() } });
    await signInAs(g.client);
    expect(await outcome(() => render(g.dealId))).toMatch(new RegExp(`^NEXT_REDIRECT;[a-z]+;/v2/deals/${g.dealId};`));
  });
});
