import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { computeDealMoney, computeSplit, kztToTiyn, MAX_PRICE_TIYN } from "./money";

const price = fc.bigInt({ min: 1n, max: MAX_PRICE_TIYN });

describe("расчёт денег сделки (ТЗ п. 6; решение основателей 22.11.2026 — 6% только с мастера)", () => {
  it("X = 1 500 000 ₸ → покупатель платит 1 500 000, мастер получает 1 410 000, доход 90 000", () => {
    expect(computeDealMoney(kztToTiyn(1_500_000))).toEqual({
      priceTiyn: 150_000_000n,
      protectionTiyn: 0n,
      buyerTotalTiyn: 150_000_000n,
      guaranteeTiyn: 9_000_000n,
      payoutTiyn: 141_000_000n,
      platformIncomeTiyn: 9_000_000n,
    });
  });

  it("покупатель ничего сверх цены не платит: защиты сделки нет", () => {
    const money = computeDealMoney(kztToTiyn(1_650_000));
    expect(money.protectionTiyn).toBe(0n);
    expect(money.buyerTotalTiyn).toBe(kztToTiyn(1_650_000));
    expect(money.payoutTiyn).toBe(kztToTiyn(1_551_000));
  });

  it("выплата округляется вниз до тиына, гарантия поглощает округление", () => {
    // 94% от 101 тиына = 94,94 → 94; гарантия 7.
    expect(computeDealMoney(101n)).toMatchObject({ protectionTiyn: 0n, buyerTotalTiyn: 101n, payoutTiyn: 94n, guaranteeTiyn: 7n, platformIncomeTiyn: 7n });
  });

  it("цена ≤ 0 или больше потолка — ошибка, а не странная сумма", () => {
    expect(() => computeDealMoney(0n)).toThrow();
    expect(() => computeDealMoney(-5n)).toThrow();
    expect(() => computeDealMoney(MAX_PRICE_TIYN + 1n)).toThrow();
  });

  it("свойство: оплачено = цена = выплата мастеру + доход платформы, до тиына", () => {
    fc.assert(
      fc.property(price, (x) => {
        const m = computeDealMoney(x);
        return m.buyerTotalTiyn === x && m.protectionTiyn === 0n && m.buyerTotalTiyn === m.payoutTiyn + m.platformIncomeTiyn && m.payoutTiyn === x - m.guaranteeTiyn;
      }),
    );
  });

  it("свойство: выплата — наибольшее целое ≤ 94% X", () => {
    fc.assert(
      fc.property(price, (x) => {
        const o = computeDealMoney(x).payoutTiyn * 100n;
        return o <= x * 94n && o + 100n > x * 94n;
      }),
    );
  });

  it("свойство: доход платформы — 6% X, округлённые вверх (меньше чем на тиын)", () => {
    fc.assert(
      fc.property(price, (x) => {
        const income = computeDealMoney(x).platformIncomeTiyn * 100n;
        return income >= x * 6n && income < x * 6n + 100n;
      }),
    );
  });
});

describe("раздел по спору (ADR-009, OPEN_QUESTIONS №38)", () => {
  const paid = (x: bigint) => computeDealMoney(x).buyerTotalTiyn;

  it("мастеру вся цена — то же, что обычная выплата, возврат 0", () => {
    const x = kztToTiyn(1_500_000);
    expect(computeSplit(x, x)).toEqual({ masterTiyn: 141_000_000n, platformTiyn: 9_000_000n, refundTiyn: 0n });
  });

  it("мастеру 0 — полный возврат всего оплаченного, доход платформы 0", () => {
    const x = kztToTiyn(1_500_000);
    expect(computeSplit(x, 0n)).toEqual({ masterTiyn: 0n, platformTiyn: 0n, refundTiyn: paid(x) });
  });

  it("мастеру больше цены или меньше нуля — ошибка", () => {
    expect(() => computeSplit(100n, 101n)).toThrow();
    expect(() => computeSplit(100n, -1n)).toThrow();
  });

  it("свойство: оплачено = мастеру + платформе + возврат, все части ≥ 0", () => {
    fc.assert(
      fc.property(price.chain((x) => fc.tuple(fc.constant(x), fc.bigInt({ min: 0n, max: x }))), ([x, y]) => {
        const s = computeSplit(x, y);
        return s.masterTiyn >= 0n && s.platformTiyn >= 0n && s.refundTiyn >= 0n && s.masterTiyn + s.platformTiyn + s.refundTiyn === paid(x);
      }),
    );
  });
});

describe("тенге в тиыны", () => {
  it("только целые тенге", () => {
    expect(kztToTiyn(12)).toBe(1200n);
    expect(() => kztToTiyn(1.5)).toThrow();
  });
});
