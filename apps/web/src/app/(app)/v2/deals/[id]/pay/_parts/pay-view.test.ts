import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { partyEstimate, type MoneyBlock } from "@/modules/payments";
import { payMoney } from "./pay-view";

const t = ru.app.deal.pay.money;
const block = (payment: "none" | "PENDING" | "FAILED"): MoneyBlock => ({ kind: "awaiting", payment, bankBalanceTiyn: 0n, isTest: false });

describe("деньги экрана оплаты — смета модуля как есть", () => {
  it("цена по оферте, защита сделки (2%) с пояснением, итого; главная сумма — итого", () => {
    const e = partyEstimate("CLIENT", 1_000_000_01n);
    expect(payMoney(e, block("none"))).toEqual({
      amount: e.totalTiyn,
      rows: [
        { label: t.price, amount: 1_000_000_01n },
        { label: t.protection, amount: e.extraTiyn, explain: true },
        { label: t.total, amount: e.totalTiyn, total: true },
      ],
      failed: false,
    });
    // Защита — вверх до тиына (ComputeDealMoney): 2% от 1 000 000,01 ₸ = 20 000,0002 → 20 000,01 ₸.
    expect(e.extraTiyn).toBe(2_000_001n);
  });

  it("прошлая оплата не прошла — пометка; ждёт банк или не начиналась — нет", () => {
    const e = partyEstimate("CLIENT", 100_000_00n);
    expect(payMoney(e, block("FAILED")).failed).toBe(true);
    expect(payMoney(e, block("PENDING")).failed).toBe(false);
  });
});
