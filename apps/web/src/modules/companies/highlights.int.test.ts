import { describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { makeClient, makeExecutor } from "../../../test/factories";
import { makeDealWithReport, makePortfolioItem } from "../../../test/factories/companies";
import type { Executor } from "../../../test/factories/deal";
import { HIGHLIGHTS_MAX, listHighlightCandidates, publicHighlights, setHighlights } from "./index";

/** Оконченная сделка мастера с офертой и фото сдачи; выбор покупателя «фото: да» по умолчанию. */
async function endedDeal(executor: Executor, opts: { photos?: boolean | null; status?: "SPLIT_PAYOUT" | "CANCELLED" | "CREATED"; signed?: boolean } = {}) {
  const d = await makeDealWithReport({ executor, dealStatus: opts.status ?? "SPLIT_PAYOUT" });
  if (opts.signed === false) await db.deal.update({ where: { id: d.dealId }, data: { signedAt: null } });
  if (opts.photos !== null) {
    await db.dealShowcase.create({ data: { dealId: d.dealId, photos: opts.photos ?? true, signedAs: "", textVersion: "test", updatedById: d.client.id } });
  }
  return d;
}

const work = (id: string) => ({ kind: "work" as const, id });
const deal = (id: string) => ({ kind: "deal" as const, id });

describe("лучшие работы: выбор мастера", () => {
  it("сохраняет работы и сделки по порядку, пустой список очищает", async () => {
    const executor = await makeExecutor();
    const a = await makePortfolioItem(executor);
    const d = await endedDeal(executor);
    const b = await makePortfolioItem(executor);

    await setHighlights(executor, { items: [deal(d.dealId), work(b.id), work(a.id)] });
    const rows = await db.executorHighlight.findMany({ where: { executorId: executor.executor.id }, orderBy: { position: "asc" } });
    expect(rows.map((r) => [r.position, r.dealId, r.portfolioItemId])).toEqual([
      [0, d.dealId, null],
      [1, null, b.id],
      [2, null, a.id],
    ]);

    await setHighlights(executor, { items: [work(a.id)] });
    expect(await db.executorHighlight.count({ where: { executorId: executor.executor.id } })).toBe(1);
    await setHighlights(executor, { items: [] });
    expect(await db.executorHighlight.count({ where: { executorId: executor.executor.id } })).toBe(0);
  });

  it("пишет аудит с набором до и после", async () => {
    const executor = await makeExecutor();
    const a = await makePortfolioItem(executor);
    await setHighlights(executor, { items: [work(a.id)] });
    await setHighlights(executor, { items: [] });
    const events = await db.auditEvent.findMany({ where: { action: "executor.highlights.changed", entityId: executor.executor.id }, orderBy: { seq: "asc" } });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ before: { items: [] }, after: { items: [{ kind: "work", id: a.id }] } });
    expect(events[1]).toMatchObject({ before: { items: [{ kind: "work", id: a.id }] }, after: { items: [] } });
  });

  it("больше шести и дубли — VALIDATION", async () => {
    const executor = await makeExecutor();
    const items = [];
    for (let i = 0; i <= HIGHLIGHTS_MAX; i++) items.push(await makePortfolioItem(executor));
    await expect(setHighlights(executor, { items: items.map((i) => work(i.id)) })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(setHighlights(executor, { items: [work(items[0].id), work(items[0].id)] })).rejects.toMatchObject({ code: "VALIDATION" });
    await setHighlights(executor, { items: items.slice(0, HIGHLIGHTS_MAX).map((i) => work(i.id)) });
  });

  it("не мастер и неодобренный мастер — FORBIDDEN", async () => {
    const client = await makeClient();
    const pending = await makeExecutor({ status: "PENDING" });
    await expect(setHighlights(client, { items: [] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(setHighlights(pending, { items: [] })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("чужая или несуществующая работа и сделка — NOT_FOUND, набор не меняется", async () => {
    const executor = await makeExecutor();
    const other = await makeExecutor();
    const mine = await makePortfolioItem(executor);
    await setHighlights(executor, { items: [work(mine.id)] });
    const foreignWork = await makePortfolioItem(other);
    const foreignDeal = await endedDeal(other);

    await expect(setHighlights(executor, { items: [work(foreignWork.id)] })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(setHighlights(executor, { items: [deal(foreignDeal.dealId)] })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(setHighlights(executor, { items: [work("нет-такой")] })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await db.executorHighlight.findMany({ where: { executorId: executor.executor.id } })).map((r) => r.portfolioItemId)).toEqual([mine.id]);
  });

  it("неопубликованная работа и работа из сделки — VALIDATION", async () => {
    const executor = await makeExecutor();
    const hidden = await makePortfolioItem(executor, { published: false });
    const fromDealItem = await makePortfolioItem(executor);
    const d = await endedDeal(executor);
    await db.portfolioItem.update({ where: { id: fromDealItem.id }, data: { dealId: d.dealId } });
    await expect(setHighlights(executor, { items: [work(hidden.id)] })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(setHighlights(executor, { items: [work(fromDealItem.id)] })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("сделка без «фото: да», без выбора, без оферты и идущая — VALIDATION", async () => {
    const executor = await makeExecutor();
    const off = await endedDeal(executor, { photos: false });
    const none = await endedDeal(executor, { photos: null });
    const unsigned = await endedDeal(executor, { status: "CANCELLED", signed: false });
    const running = await endedDeal(executor, { status: "CREATED" });
    for (const d of [off, none, unsigned, running]) {
      await expect(setHighlights(executor, { items: [deal(d.dealId)] })).rejects.toMatchObject({ code: "VALIDATION" });
    }
    const cancelled = await endedDeal(executor, { status: "CANCELLED" });
    await setHighlights(executor, { items: [deal(cancelled.dealId)] });
  });
});

describe("лучшие работы: публичная витрина", () => {
  it("порядок по position, фото работы и сделки, у сделки нет ссылки", async () => {
    const executor = await makeExecutor();
    const a = await makePortfolioItem(executor, { title: "Шкаф" });
    const d = await endedDeal(executor);
    await setHighlights(executor, { items: [deal(d.dealId), work(a.id)] });

    const cards = await publicHighlights(executor.executor.id);
    expect(cards.map((c) => [c.kind, c.id])).toEqual([
      ["deal", d.dealId],
      ["work", a.id],
    ]);
    expect(cards[0]).toMatchObject({ title: "Кухня", href: null });
    expect(cards[0].photo?.src).toContain("delivery/test/");
    expect(cards[0].photo?.alt).toContain("Кухня");
    expect(cards[1]).toMatchObject({ title: "Шкаф" });
    expect(cards[1].photo?.src).toContain("test-");
  });

  it("сделка без фото сдачи — карточка без фото", async () => {
    const executor = await makeExecutor();
    const d = await makeDealWithReport({ executor, photos: 0 });
    await db.dealShowcase.create({ data: { dealId: d.dealId, photos: true, signedAs: "", textVersion: "test", updatedById: d.client.id } });
    await setHighlights(executor, { items: [deal(d.dealId)] });
    expect(await publicHighlights(executor.executor.id)).toMatchObject([{ id: d.dealId, photo: null }]);
  });

  it("сделка, у которой покупатель снял «фото», выпадает", async () => {
    const executor = await makeExecutor();
    const a = await makePortfolioItem(executor);
    const d = await endedDeal(executor);
    await setHighlights(executor, { items: [deal(d.dealId), work(a.id)] });
    await db.dealShowcase.update({ where: { dealId: d.dealId }, data: { photos: false } });
    expect((await publicHighlights(executor.executor.id)).map((c) => c.id)).toEqual([a.id]);
    await db.dealShowcase.delete({ where: { dealId: d.dealId } });
    expect((await publicHighlights(executor.executor.id)).map((c) => c.id)).toEqual([a.id]);
  });

  it("работа, снятая с публикации, выпадает; удалённая — уходит из набора", async () => {
    const executor = await makeExecutor();
    const a = await makePortfolioItem(executor);
    const b = await makePortfolioItem(executor);
    await setHighlights(executor, { items: [work(a.id), work(b.id)] });
    await db.portfolioItem.update({ where: { id: a.id }, data: { published: false } });
    expect((await publicHighlights(executor.executor.id)).map((c) => c.id)).toEqual([b.id]);
    await db.portfolioItem.delete({ where: { id: b.id } });
    expect(await db.executorHighlight.count({ where: { executorId: executor.executor.id } })).toBe(1);
    expect(await publicHighlights(executor.executor.id)).toEqual([]);
  });

  it("мастер не виден (заблокирован, не одобрен) — пусто; название сделки проходит маску", async () => {
    const executor = await makeExecutor({ legalName: "ИП Ким Руслан" });
    const d = await endedDeal(executor);
    await db.deal.update({ where: { id: d.dealId }, data: { title: "Кухня Ким Руслан" } });
    await setHighlights(executor, { items: [deal(d.dealId)] });
    const [card] = await publicHighlights(executor.executor.id);
    expect(card.title).not.toContain("Руслан");

    await db.user.update({ where: { id: executor.id }, data: { blockedAt: new Date() } });
    expect(await publicHighlights(executor.executor.id)).toEqual([]);
    await db.user.update({ where: { id: executor.id }, data: { blockedAt: null } });
    await db.executorProfile.update({ where: { id: executor.executor.id }, data: { status: "PENDING" } });
    expect(await publicHighlights(executor.executor.id)).toEqual([]);
  });
});

describe("лучшие работы: кандидаты мастера", () => {
  it("работы и сделки по правилам выбора, с пометкой позиции", async () => {
    const executor = await makeExecutor();
    const other = await makeExecutor();
    const a = await makePortfolioItem(executor);
    await makePortfolioItem(executor, { published: false });
    await makePortfolioItem(other);
    const ok = await endedDeal(executor);
    await endedDeal(executor, { photos: false });
    await endedDeal(executor, { photos: null });
    await endedDeal(executor, { status: "CANCELLED", signed: false, photos: false });
    await endedDeal(other, { photos: false });
    await endedDeal(other);
    await endedDeal(executor, { status: "CREATED", photos: null });
    await setHighlights(executor, { items: [deal(ok.dealId)] });

    const { items: list, hiddenDeals } = await listHighlightCandidates(executor);
    // Сделки без разрешения фото (с выбором «нет» и без выбора) в кандидатах не показаны, но посчитаны; чужая, без оферты и не оконченная — нет.
    expect(hiddenDeals).toBe(2);
    expect(list.map((c) => [c.kind, c.id, c.selected, c.position]).sort()).toEqual(
      [
        ["deal", ok.dealId, true, 0],
        ["work", a.id, false, null],
      ].sort(),
    );
  });

  it("не мастер — FORBIDDEN", async () => {
    await expect(listHighlightCandidates(await makeClient())).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
