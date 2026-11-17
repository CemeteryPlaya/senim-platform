import { afterEach, describe, expect, it } from "vitest";
import { dealAt } from "../../../test/factories/deal";
import { db } from "@/platform/db";
import { resetEnvCache } from "@/platform/env";
import type { DealStatus } from "@/generated/prisma/enums";
import { getDealView, leaveReview, nextStepsOf } from "./index";

afterEach(() => {
  delete process.env.FEATURE_REVIEWS;
  resetEnvCache();
});

/** Сделка с офертой, доведённая до нужного конечного статуса напрямую в базе (путь к статусу не важен для отзыва). */
async function endedAt(status: DealStatus) {
  const f = await dealAt("SIGNED");
  await db.deal.update({ where: { id: f.dealId }, data: { status } });
  return f;
}

describe("отзыв после окончания сделки с офертой", () => {
  it("отзыв: успешно, отмена после оферты, возврат — можно, один раз", async () => {
    for (const status of ["SPLIT_PAYOUT", "CANCELLED", "REFUNDED"] as const) {
      const f = await endedAt(status);
      expect((await db.deal.findUniqueOrThrow({ where: { id: f.dealId } })).signedAt).not.toBeNull();
      await leaveReview(f.client, { dealId: f.dealId, rating: 4 });
      expect(await db.review.count({ where: { dealId: f.dealId } })).toBe(1);
      await expect(leaveReview(f.client, { dealId: f.dealId, rating: 5 })).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await db.review.count({ where: { dealId: f.dealId } })).toBe(1);
    }
  });

  it("отмена до оферты (signedAt пуст) — CONFLICT reviewOnlyCompleted, отзыва нет", async () => {
    const f = await endedAt("CANCELLED");
    await db.deal.update({ where: { id: f.dealId }, data: { signedAt: null } });
    await expect(leaveReview(f.client, { dealId: f.dealId, rating: 5 })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.review.count({ where: { dealId: f.dealId } })).toBe(0);
  });

  it("идущая сделка — CONFLICT", async () => {
    const f = await dealAt("IN_PROGRESS");
    await expect(leaveReview(f.client, { dealId: f.dealId, rating: 5 })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("«что дальше»: у отменённой и возвращённой с офертой — отзыв покупателя, без оферты — нет", async () => {
    for (const status of ["CANCELLED", "REFUNDED"] as const) {
      const f = await endedAt(status);
      const full = (await getDealView(f.client, f.dealId)).next;
      expect(full).toEqual({ action: "leaveReview", mine: true });
      expect((await nextStepsOf(f.client, [f.dealId])).get(f.dealId)).toEqual(full);
      await db.deal.update({ where: { id: f.dealId }, data: { signedAt: null } });
      expect((await getDealView(f.client, f.dealId)).next.action).not.toBe("leaveReview");
      expect((await nextStepsOf(f.client, [f.dealId])).get(f.dealId)?.action).not.toBe("leaveReview");
    }
  });
});
