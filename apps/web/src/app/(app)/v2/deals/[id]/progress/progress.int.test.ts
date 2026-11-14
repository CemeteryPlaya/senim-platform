import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ru } from "@/i18n/ru";
import { db } from "@/platform/db";
import { dealAt, makePhoto } from "../../../../../../../test/factories/deal";
import { freshBrowser } from "../../../../../../../test/factories/identity";
import { signInAs } from "../../../../../../../test/factories/session";
import DealPage from "../page";
import { progressReportAction } from "./actions";
import ProgressPage from "./page";

vi.mock("@/platform/device", () => ({ getDevice: async () => "mobile" }));
vi.mock("next/headers", async () => (await import("../../../../../../../test/factories/identity")).nextHeadersMock);
vi.mock("next/navigation", async (importActual) => ({ ...(await importActual<typeof import("next/navigation")>()), useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));

const t = ru.app.masterSteps.progress;

beforeEach(() => freshBrowser({ "user-agent": "vitest" }));

const reportsOf = (dealId: string) => db.progressReport.findMany({ where: { dealId }, include: { photos: true } });
const render = async (id: string) => renderToStaticMarkup(await ProgressPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));
const card = async (id: string) => renderToStaticMarkup(await DealPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));
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

const verified = (id: string) => db.user.update({ where: { id }, data: { emailVerifiedAt: new Date() } });

describe("progressReportAction", () => {
  it("отчёт с заголовком, текстом и фото — в ленте сделки", async () => {
    const f = await dealAt("IN_PROGRESS");
    await signInAs(f.executor);
    const photo = await makePhoto(f.executor, "PROGRESS_REPORT");
    const r = await progressReportAction({ dealId: f.dealId, title: "Корпус готов", text: "Собрал корпус, ставлю фасады", photoIds: [photo] });
    expect(r.ok).toBe(true);
    const [report] = await reportsOf(f.dealId);
    expect(report?.title).toBe("Корпус готов");
    expect(report?.photos.map((p) => p.id)).toEqual([photo]);
  });

  it("короткий текст — ошибка у поля текстом экрана, отчёта нет; до начала работ — отказ «пока идут работы»", async () => {
    const f = await dealAt("IN_PROGRESS");
    await signInAs(f.executor);
    expect(await progressReportAction({ dealId: f.dealId, text: "а" })).toMatchObject({ ok: false, code: "VALIDATION", fieldErrors: { text: [t.errors.text] } });
    expect(await reportsOf(f.dealId)).toHaveLength(0);
    const paid = await dealAt("PAID_HOLD");
    await signInAs(paid.executor);
    expect(await progressReportAction({ dealId: paid.dealId, text: "Начал раньше времени" })).toMatchObject({ ok: false, code: "CONFLICT", error: t.errors.notNow });
  });
});

describe("экран отчёта и лента на карточке", () => {
  it("мастер, идут работы: форма отчёта и одно главное действие; до начала работ и покупателю — карточка сделки", async () => {
    const f = await dealAt("IN_PROGRESS");
    await verified(f.executor.id);
    await signInAs(f.executor);
    const out = await render(f.dealId);
    expect(out.match(/<h1/g)).toHaveLength(1);
    expect(plain(out)).toContain(t.textLabel);
    expect([...out.matchAll(/data-primary-action/g)]).toHaveLength(1);
    expect(out).toContain(t.submit);
    await verified(f.client.id);
    await signInAs(f.client);
    expect(await outcome(() => render(f.dealId))).toMatch(new RegExp(`^NEXT_REDIRECT;[a-z]+;/v2/deals/${f.dealId};`));
  });

  it("покупатель видит отчёты мастера на карточке сделки (текст и фото); без отчётов — блока нет", async () => {
    const f = await dealAt("IN_PROGRESS");
    await verified(f.client.id);
    await signInAs(f.client);
    expect(plain(await card(f.dealId))).not.toContain(ru.app.deal.card.reports.section);
    await signInAs(f.executor);
    expect((await progressReportAction({ dealId: f.dealId, title: "Корпус готов", text: "Собрал корпус, ставлю фасады", photoIds: [await makePhoto(f.executor, "PROGRESS_REPORT")] })).ok).toBe(true);
    await signInAs(f.client);
    const out = await card(f.dealId);
    expect(plain(out)).toContain(ru.app.deal.card.reports.section);
    expect(plain(out)).toContain("Собрал корпус, ставлю фасады");
    expect(out).toContain(`alt="${ru.app.masterDeal.card.reports.photoAlt("Корпус готов", 1)}"`);
    expect(plain(out)).not.toContain(ru.app.masterDeal.card.reports.add);
  });
});
