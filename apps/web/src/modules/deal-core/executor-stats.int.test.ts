import { describe, expect, it } from "vitest";
import type { DealStatus } from "@/generated/prisma/enums";
import { makeExecutor } from "../../../test/factories";
import { makeDeal, type Executor } from "../../../test/factories/deal";
import { db } from "@/platform/db";
import { executorStats } from "./executor-stats";

/** Сделка мастера в нужном статусе; signedAt — по умолчанию есть (оферта заключена). */
async function dealOf(executor: Executor, status: DealStatus, signed = true) {
  const f = await makeDeal({ executor });
  await db.deal.update({ where: { id: f.dealId }, data: { status, signedAt: signed ? new Date() : null } });
}

describe("числа мастера", () => {
  it("идущая, успешная, отмена и возврат с офертой, отмена без оферты → 4 / 3 / 1 / 33%", async () => {
    const executor = await makeExecutor();
    await dealOf(executor, "IN_PROGRESS");
    await dealOf(executor, "SPLIT_PAYOUT");
    await dealOf(executor, "CANCELLED");
    await dealOf(executor, "REFUNDED");
    await dealOf(executor, "CANCELLED", false);

    const stats = await executorStats([executor.executor.id]);
    expect(stats.get(executor.executor.id)).toEqual({ deals: 4, ended: 3, successful: 1, successRate: 33 });
  });

  it("нет оконченных — доля не считается (null)", async () => {
    const executor = await makeExecutor();
    await dealOf(executor, "PAID_HOLD");
    await dealOf(executor, "CANCELLED", false);

    expect((await executorStats([executor.executor.id])).get(executor.executor.id)).toEqual({ deals: 1, ended: 0, successful: 0, successRate: null });
  });

  it("несколько мастеров одним вызовом; мастер без сделок — нули; пустой список — пустая Map", async () => {
    const a = await makeExecutor();
    const b = await makeExecutor();
    const empty = await makeExecutor();
    await dealOf(a, "SPLIT_PAYOUT");
    await dealOf(b, "SPLIT_PAYOUT");
    await dealOf(b, "REFUNDED");

    const stats = await executorStats([a.executor.id, b.executor.id, empty.executor.id, a.executor.id]);
    expect(stats.get(a.executor.id)).toEqual({ deals: 1, ended: 1, successful: 1, successRate: 100 });
    expect(stats.get(b.executor.id)).toEqual({ deals: 2, ended: 2, successful: 1, successRate: 50 });
    expect(stats.get(empty.executor.id)).toEqual({ deals: 0, ended: 0, successful: 0, successRate: null });
    expect((await executorStats([])).size).toBe(0);
  });
});
