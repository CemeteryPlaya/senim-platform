import { describe, expect, it } from "vitest";
import type { DealStatus, DisputeOutcome, MoneyTransactionType } from "@/generated/prisma/enums";
import { makeDeal } from "../../../test/factories/deal";
import { SYSTEM } from "@/modules/audit";
import { db, transaction } from "@/platform/db";
import { lockDeal, moveDeal } from "./state";
import { DEAL_STATUSES, DEAL_TRANSITIONS, findTransition, type Who } from "./transitions";

/**
 * Каждый разрешённый и каждый запрещённый переход (from, to) — на настоящей тестовой БД через moveDeal:
 * условное обновление, аудит, отказ без изменения строки. Контекст (подпись, журнал, акт, спор) готовится в БД.
 */

const WHO: Who[] = ["CLIENT", "EXECUTOR", "OPERATOR", "SYSTEM"];
const actor = SYSTEM("test");

async function op(dealId: string, type: MoneyTransactionType, extra: { parentId?: string; disputeId?: string } = {}) {
  return db.moneyTransaction.create({
    data: { dealId, type, amountTiyn: 100n, idempotencyKey: `${type}:${dealId}:${Math.random()}`, provider: "MOCK", isTest: true, status: "SUCCEEDED", settledAt: new Date(), ...extra },
  });
}

async function dispute(dealId: string, userId: string, outcome: DisputeOutcome | null) {
  return db.dispute.create({
    data: {
      dealId,
      openedById: userId,
      openedInStatus: "IN_PROGRESS",
      reason: "OTHER",
      description: "Тестовый спор",
      status: outcome ? "RESOLVED" : "OPEN",
      outcome,
      masterShareTiyn: outcome === "PARTIAL_SPLIT" ? 1n : null,
    },
  });
}

async function payout(dealId: string) {
  const release = await op(dealId, "RELEASE");
  await op(dealId, "SPLIT_MASTER", { parentId: release.id });
  await op(dealId, "SPLIT_PLATFORM", { parentId: release.id });
}

/** Подготовить условие разрешённого перехода в БД. */
async function satisfy(dealId: string, userId: string, from: DealStatus, to: DealStatus) {
  await db.deal.update({ where: { id: dealId }, data: { status: from, signedAt: new Date() } });
  if (from === "CREATED" && to === "CANCELLED") return;
  await op(dealId, "HOLD");
  if (to === "REFUNDED") {
    await op(dealId, "REFUND");
    if (from !== "PAID_HOLD") await dispute(dealId, userId, "FULL_REFUND");
  }
  if (to === "SPLIT_PAYOUT") {
    await payout(dealId);
    if (from !== "ACCEPTED") await dispute(dealId, userId, "PARTIAL_SPLIT");
  }
  if (to === "ACCEPTED") {
    const doc = await db.document.findFirstOrThrow({ where: { dealId, kind: "CONTRACT" } });
    const file = await db.storedFile.create({ data: { storageKey: `act/${dealId}`, provider: "pending", purpose: "DOCUMENT", contentType: "application/pdf", size: 0, sha256: doc.sha256 } });
    await db.document.create({ data: { dealId, kind: "ACCEPTANCE_ACT", number: "А-1", fileId: file.id, sha256: doc.sha256, status: "SIGNED" } });
  }
}

const move = (dealId: string, to: DealStatus, who: Who) => transaction(async (tx) => moveDeal(tx, await lockDeal(tx, dealId), { to, who, actor, action: "test.moved" }));
const statusOf = async (dealId: string) => (await db.deal.findUniqueOrThrow({ where: { id: dealId } })).status;

describe("запрещённые переходы: строка не меняется", () => {
  it.each(DEAL_STATUSES)("из %s", async (from) => {
    const f = await makeDeal();
    await db.deal.update({ where: { id: f.dealId }, data: { status: from, signedAt: new Date() } });
    const forbidden = DEAL_STATUSES.filter((to) => !findTransition(from, to));
    for (const to of forbidden) {
      for (const who of WHO) await expect(move(f.dealId, to, who), `${from} → ${to} (${who})`).rejects.toMatchObject({ code: "CONFLICT" });
    }
    expect(await statusOf(f.dealId)).toBe(from);
    expect(await db.auditEvent.count({ where: { action: "test.moved" } })).toBe(0);
  });
});

describe("разрешённые переходы", () => {
  it.each(DEAL_TRANSITIONS.map((t) => [t.from, t.to, t] as const))("%s → %s", async (from, to, row) => {
    const f = await makeDeal();
    await satisfy(f.dealId, f.client.id, from, to);

    for (const who of WHO.filter((w) => !row.who.includes(w))) await expect(move(f.dealId, to, who)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const open = await dispute(f.dealId, f.client.id, null);
    await expect(move(f.dealId, to, row.who[0])).rejects.toMatchObject({ code: "CONFLICT" });
    await db.dispute.delete({ where: { id: open.id } });
    expect(await statusOf(f.dealId)).toBe(from);

    await move(f.dealId, to, row.who[0]);
    expect(await statusOf(f.dealId)).toBe(to);
    expect(await db.auditEvent.findFirstOrThrow({ where: { action: "test.moved" } })).toMatchObject({ before: { status: from }, after: { status: to }, scope: `deal:${f.dealId}` });
    // Повтор того же перехода (двойной клик после успеха) — уже не из этого статуса.
    await expect(move(f.dealId, to, row.who[0])).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("гонка двух одинаковых переходов — ровно один успех", async () => {
    const f = await makeDeal();
    await satisfy(f.dealId, f.client.id, "PAID_HOLD", "IN_PROGRESS");
    const results = await Promise.allSettled([move(f.dealId, "IN_PROGRESS", "EXECUTOR"), move(f.dealId, "IN_PROGRESS", "EXECUTOR")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.auditEvent.count({ where: { action: "test.moved" } })).toBe(1);
  });
});
