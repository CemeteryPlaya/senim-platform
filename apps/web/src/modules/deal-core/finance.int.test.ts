import { describe, expect, it } from "vitest";
import { dealAt, PRICE, signAct } from "../../../test/factories/deal";
import { makeClient } from "../../../test/factories";
import { computeDealMoney } from "@/modules/payments";
import { db } from "@/platform/db";
import { getExecutorFinance, monthOf, processDealMoney } from "./index";

const money = computeDealMoney(PRICE);

describe("финансы мастера — из журнала", () => {
  it("получено — подтверждённые SPLIT_MASTER по месяцам; зарезервировано — оплаченные без выплаты", async () => {
    const done = await dealAt("READY");
    await signAct(done.dealId);
    await processDealMoney(done.dealId);
    const reserved = await dealAt("IN_PROGRESS", { executor: done.executor });
    await dealAt("SIGNED", { executor: done.executor }); // без оплаты — не считается

    const finance = await getExecutorFinance(done.executor);
    expect(finance.receivedTiyn).toBe(money.payoutTiyn);
    expect(finance.reservedTiyn).toBe(money.payoutTiyn);
    const paidAt = (await db.moneyTransaction.findFirstOrThrow({ where: { dealId: done.dealId, type: "SPLIT_MASTER" } })).settledAt!;
    expect(finance.months).toEqual([{ month: monthOf(paidAt), receivedTiyn: money.payoutTiyn, deals: 1 }]);
    expect(finance.rows.map((r) => [r.dealId, r.state]).sort()).toEqual([
      [done.dealId, "received"],
      [reserved.dealId, "reserved"],
    ].sort());
  });

  it("месяц — по времени Казахстана (UTC+5); только для мастера", async () => {
    expect(monthOf(new Date("2026-10-31T19:30:00Z"))).toBe("2026-11");
    expect(monthOf(new Date("2026-10-31T18:59:59Z"))).toBe("2026-10");
    await expect(getExecutorFinance(await makeClient())).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
