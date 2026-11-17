import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { HIGHLIGHTS_MAX, listHighlightCandidates } from "@/modules/companies";
import { db } from "@/platform/db";
import { makeExecutor } from "../../../../../../../test/factories";
import { makeDealWithReport, makePortfolioItem } from "../../../../../../../test/factories/companies";
import { freshBrowser } from "../../../../../../../test/factories/identity";
import { signInAs } from "../../../../../../../test/factories/session";

const h = vi.hoisted(() => ({ device: "mobile" as "mobile" | "desktop" }));
vi.mock("@/platform/device", () => ({ getDevice: async () => h.device }));
vi.mock("next/headers", async () => (await import("../../../../../../../test/factories/identity")).nextHeadersMock);
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} }),
}));

const { default: BestPage } = await import("./page");
const { default: PortfolioPage } = await import("../page");
const { saveBestAction } = await import("./actions");

const t = ru.app.masterPortfolio.best;
const primaries = (out: string) => out.split("data-primary-action").length - 1;
const render = async (el: ReactElement | Promise<ReactElement>) => renderToStaticMarkup(await el);
const checkboxes = (out: string) => out.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? [];

beforeEach(() => {
  freshBrowser({ "user-agent": "vitest" });
  h.device = "mobile";
});

async function master(opts: Parameters<typeof makeExecutor>[0] = {}) {
  const executor = await makeExecutor(opts);
  await db.user.update({ where: { id: executor.id }, data: { emailVerifiedAt: new Date() } });
  await signInAs(executor);
  return executor;
}

/** Оконченная сделка мастера с офертой и фото сдачи; выбор покупателя «фото» — по параметру. */
async function endedDeal(executor: Awaited<ReturnType<typeof master>>, photos: boolean | null = true) {
  const d = await makeDealWithReport({ executor, dealStatus: "SPLIT_PAYOUT" });
  if (photos !== null) await db.dealShowcase.create({ data: { dealId: d.dealId, photos, signedAs: "", textVersion: "test", updatedById: d.client.id } });
  return d;
}

describe("экран «Лучшие работы»", () => {
  it("кандидаты: работы и сделки с разрешёнными фото; без разрешения — нет, но есть подсказка; «Назад» и одно главное действие", async () => {
    const executor = await master();
    await makePortfolioItem(executor, { title: "Кухня с островом" });
    await makePortfolioItem(executor, { title: "Скрытый шкаф", published: false });
    await endedDeal(executor);
    await endedDeal(executor, false);
    await endedDeal(executor, null);
    for (const device of ["mobile", "desktop"] as const) {
      h.device = device;
      const out = await render(BestPage());
      expect(out).toContain("Кухня с островом");
      expect(out).not.toContain("Скрытый шкаф");
      expect(checkboxes(out)).toHaveLength(2);
      expect(out).toContain(t.hiddenDeals(2));
      expect(out).toContain(t.back);
      expect(primaries(out)).toBe(1);
      expect((out.match(/<h1/g) ?? []).length).toBe(1);
    }
  });

  it("выбранные идут первыми в порядке сохранения, со стрелками «Выше» и «Ниже» с названием", async () => {
    const executor = await master();
    const a = await makePortfolioItem(executor, { title: "Первая работа" });
    const b = await makePortfolioItem(executor, { title: "Вторая работа" });
    await makePortfolioItem(executor, { title: "Третья работа" });
    expect(await saveBestAction({ items: [{ kind: "work", id: b.id }, { kind: "work", id: a.id }] })).toMatchObject({ ok: true });
    const out = await render(BestPage());
    expect(out.indexOf("Вторая работа")).toBeLessThan(out.indexOf("Первая работа"));
    expect(out.indexOf("Первая работа")).toBeLessThan(out.indexOf("Третья работа"));
    expect(out).toContain(t.up("Первая работа"));
    expect(out).toContain(t.down("Вторая работа"));
    expect(out).toContain(t.counter(2, HIGHLIGHTS_MAX));
  });

  it("шесть выбраны — остальные отметки недоступны, подсказка о пределе", async () => {
    const executor = await master();
    const items = [];
    for (let i = 0; i < 7; i += 1) items.push(await makePortfolioItem(executor, { title: `Работа ${i}` }));
    await saveBestAction({ items: items.slice(0, 6).map((it) => ({ kind: "work" as const, id: it.id })) });
    const out = await render(BestPage());
    const boxes = checkboxes(out);
    expect(boxes).toHaveLength(7);
    expect(boxes.filter((b) => /disabled/.test(b))).toHaveLength(1);
    expect(out).toContain(t.limit(HIGHLIGHTS_MAX));
    // Подсказка связана с недоступной отметкой; область для диктора после перестановки есть и пока пуста.
    expect(out).toContain('id="best-limit"');
    expect(boxes.find((b) => /disabled/.test(b))).toContain('aria-describedby="best-limit"');
    expect(out).toContain('aria-live="polite"');
  });

  it("пусто — обучающий экран без формы", async () => {
    await master();
    const out = await render(BestPage());
    expect(out).toContain(t.empty.title);
    expect(checkboxes(out)).toHaveLength(0);
  });

  it("мастер на проверке — редирект", async () => {
    await master({ status: "PENDING" });
    await expect(render(BestPage())).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
  });
});

describe("действие «Сохранить»", () => {
  it("сохраняет набор по порядку; повтор с тем же ключом — тот же результат; пустой очищает", async () => {
    const executor = await master();
    const a = await makePortfolioItem(executor);
    const d = await endedDeal(executor);
    const input = { items: [{ kind: "deal" as const, id: d.dealId }, { kind: "work" as const, id: a.id }], clientKey: crypto.randomUUID() };
    expect(await saveBestAction(input)).toMatchObject({ ok: true });
    expect(await saveBestAction(input)).toMatchObject({ ok: true });
    const { items } = await listHighlightCandidates(executor);
    expect(items.filter((c) => c.selected).map((c) => [c.id, c.position]).sort()).toEqual([[a.id, 1], [d.dealId, 0]].sort());
    expect(await saveBestAction({ items: [] })).toMatchObject({ ok: true });
    expect((await listHighlightCandidates(executor)).items.some((c) => c.selected)).toBe(false);
  });

  it("отказы: седьмая и дубль — схема; чужая работа — понятный текст; мастер на проверке — отказ", async () => {
    const executor = await master();
    const other = await makeExecutor();
    const foreign = await makePortfolioItem(other);
    const mine = await makePortfolioItem(executor);
    const seven = Array.from({ length: 7 }, (_, i) => ({ kind: "work" as const, id: `w${i}` }));
    expect(await saveBestAction({ items: seven })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await saveBestAction({ items: [{ kind: "work", id: mine.id }, { kind: "work", id: mine.id }] })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await saveBestAction({ items: [{ kind: "work", id: foreign.id }] })).toMatchObject({ ok: false, code: "NOT_FOUND", error: t.errors.changed });
    await master({ status: "PENDING" });
    expect(await saveBestAction({ items: [] })).toMatchObject({ ok: false, code: "FORBIDDEN", error: t.errors.approvedOnly });
  });
});

describe("ссылка на странице портфолио", () => {
  it("видна одобренному мастеру и без работ: N = 0", async () => {
    await master();
    const out = await render(PortfolioPage());
    expect(out).toContain(ru.app.masterPortfolio.list.best(0, HIGHLIGHTS_MAX));
    expect(out).toContain('href="/v2/executor/portfolio/best"');
  });

  it("«Лучшие работы: N из 6» ведёт на экран выбора; мастеру на проверке ссылки нет", async () => {
    const executor = await master();
    const a = await makePortfolioItem(executor);
    await saveBestAction({ items: [{ kind: "work", id: a.id }] });
    const out = await render(PortfolioPage());
    expect(out).toContain(ru.app.masterPortfolio.list.best(1, HIGHLIGHTS_MAX));
    expect(out).toContain('href="/v2/executor/portfolio/best"');
    await master({ status: "PENDING" });
    expect(await render(PortfolioPage())).not.toContain('/v2/executor/portfolio/best"');
  });
});
