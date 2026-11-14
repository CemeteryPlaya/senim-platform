import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { formatDays } from "@/features/format/format";
import { ru } from "@/i18n/ru";
import { computeDealMoney } from "@/modules/payments";
import { formatMoney } from "@/kit";
import { db } from "@/platform/db";
import { dealAt, dealOf, PRICE } from "../../../../../../../test/factories/deal";
import { freshBrowser } from "../../../../../../../test/factories/identity";
import { signInAs } from "../../../../../../../test/factories/session";
import { startWorkAction } from "./actions";
import StartPage from "./page";

vi.mock("@/platform/device", () => ({ getDevice: async () => "mobile" }));
vi.mock("next/headers", async () => (await import("../../../../../../../test/factories/identity")).nextHeadersMock);
vi.mock("next/navigation", async (importActual) => ({ ...(await importActual<typeof import("next/navigation")>()), useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));

const t = ru.app.masterSteps.start;

beforeEach(() => freshBrowser({ "user-agent": "vitest" }));

const codeOf = (r: { ok: boolean; code?: string }) => (r.ok ? "ok" : r.code);
const started = (dealId: string) => db.auditEvent.count({ where: { scope: `deal:${dealId}`, action: "deal.started" } });
const render = async (id: string) => renderToStaticMarkup(await StartPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));
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

async function asMaster(f: { executor: { id: string } }) {
  await db.user.update({ where: { id: f.executor.id }, data: { emailVerifiedAt: new Date() } });
  await signInAs(f.executor);
}

describe("startWorkAction", () => {
  it("двойное нажатие (два параллельных вызова) — один переход в IN_PROGRESS, оба ответа успех; повтор позже — тот же успех", async () => {
    const f = await dealAt("PAID_HOLD");
    await signInAs(f.executor);
    const results = await Promise.all([startWorkAction({ dealId: f.dealId }), startWorkAction({ dealId: f.dealId })]);
    expect(results.map(codeOf)).toEqual(["ok", "ok"]);
    expect((await dealOf(f.dealId)).status).toBe("IN_PROGRESS");
    expect(await started(f.dealId)).toBe(1);
    expect(codeOf(await startWorkAction({ dealId: f.dealId }))).toBe("ok");
    expect(await started(f.dealId)).toBe(1);
  });

  it("оплаты ещё нет — отказ текстом экрана, перехода нет; покупатель этим действием не начинает", async () => {
    const f = await dealAt("SIGNED");
    await signInAs(f.executor);
    expect(await startWorkAction({ dealId: f.dealId })).toMatchObject({ ok: false, code: "CONFLICT", error: t.errors.changed });
    await signInAs(f.client);
    expect((await startWorkAction({ dealId: f.dealId })).ok).toBe(false);
    expect((await dealOf(f.dealId)).status).toBe("CREATED");
  });
});

describe("экран «Начать работу»", () => {
  it("шаг мастера: «Назад» к сделке, «Сейчас / Дальше», срок по оферте, одно главное действие; сумм покупателя нет", async () => {
    const f = await dealAt("PAID_HOLD");
    await asMaster(f);
    const out = await render(f.dealId);
    expect(out.match(/<h1/g)).toHaveLength(1);
    expect(out).toContain(`href="/v2/deals/${f.dealId}"`);
    expect(plain(out)).toContain(t.now.title);
    expect(plain(out)).toContain(formatDays(30));
    expect([...out.matchAll(/data-primary-action/g)]).toHaveLength(1);
    expect(out).toContain(t.submit);
    const m = computeDealMoney(PRICE);
    expect(plain(out)).not.toContain(formatMoney(m.buyerTotalTiyn).replace(/[  ]/g, " "));
  });

  it("не шаг мастера (покупатель; работа уже идёт) — карточка сделки без ошибки", async () => {
    const f = await dealAt("PAID_HOLD");
    await db.user.update({ where: { id: f.client.id }, data: { emailVerifiedAt: new Date() } });
    await signInAs(f.client);
    expect(await outcome(() => render(f.dealId))).toMatch(new RegExp(`^NEXT_REDIRECT;[a-z]+;/v2/deals/${f.dealId};`));
    const going = await dealAt("IN_PROGRESS");
    await asMaster(going);
    expect(await outcome(() => render(going.dealId))).toMatch(new RegExp(`^NEXT_REDIRECT;[a-z]+;/v2/deals/${going.dealId};`));
  });
});
