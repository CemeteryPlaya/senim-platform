import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { computeDealMoney, type MoneyBlock, type MoneyView } from "@/modules/payments";
import { formatTiyn } from "@/ui/format";
import { homeDealMoney } from "./home-deal-money";

// Карточка «Моя сделка» на главной покупателя: сумма и подпись только из журнала денег.
const X = 145_000_000n; // цена по оферте 1 450 000 ₸
const money = computeDealMoney(X);
const estimate = { totalTiyn: money.buyerTotalTiyn };
const c = ru.common.home.client;
const at = new Date("2026-11-10T07:00:00Z");
const block = (m: MoneyView, bankBalanceTiyn: bigint): MoneyBlock => ({ ...m, bankBalanceTiyn, isTest: false });
const text = (r: ReturnType<typeof homeDealMoney>) => `${r.amountTiyn === null ? "" : `${formatTiyn(r.amountTiyn)} `}${r.label}`.replace(/ /g, " ");

describe("«Моя сделка»: деньги на главной из журнала", () => {
  it("до оплаты — смета «к оплате»: цена + защита 2%", () => {
    const r = homeDealMoney(block({ kind: "awaiting", payment: "none" }, 0n), estimate);
    expect(r).toEqual({ amountTiyn: money.buyerTotalTiyn, label: c.toPay });
    expect(text(r)).toBe("1 479 000 ₸ к оплате");
  });

  it("оплачено — в банке вся оплата покупателя (HOLD)", () => {
    const r = homeDealMoney(block({ kind: "protected", amountTiyn: money.buyerTotalTiyn, reservedAt: at, operationRef: null }, money.buyerTotalTiyn), estimate);
    expect(r).toEqual({ amountTiyn: money.buyerTotalTiyn, label: c.inBank });
    expect(text(r)).toBe("1 479 000 ₸ в банке под защитой");
  });

  it("спор — в банке остаток на счёте, а не замороженная выплата мастеру", () => {
    const r = homeDealMoney(block({ kind: "frozen", amountTiyn: money.payoutTiyn, frozenAt: at }, money.buyerTotalTiyn), estimate);
    expect(r.amountTiyn).toBe(money.buyerTotalTiyn);
    expect(r.amountTiyn).not.toBe(money.payoutTiyn);
    expect(text(r)).toBe("1 479 000 ₸ в банке под защитой");
  });

  it("приёмка подписана, выплата идёт — итог блока денег, не «к оплате»", () => {
    const r = homeDealMoney(
      block({ kind: "completed", paidToMasterTiyn: money.payoutTiyn, protectionTiyn: money.protectionTiyn, refundedTiyn: 0n, settled: false, completedAt: null }, money.buyerTotalTiyn),
      estimate,
    );
    expect(r).toEqual({ amountTiyn: null, label: ru.payments.block.completed.pending });
    expect(r.label).not.toBe(c.toPay);
  });

  it("возврат — заголовок блока денег с суммой возврата", () => {
    const r = homeDealMoney(block({ kind: "refunded", amountTiyn: money.buyerTotalTiyn, settled: true, refundedAt: at }, 0n), estimate);
    expect(r.amountTiyn).toBeNull();
    expect(r.label.replace(/ /g, " ")).toContain("1 479 000 ₸");
  });
});
