import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { computeDealMoney, computeSplit, kztToTiyn, MAX_PRICE_TIYN } from "./money";

const price = fc.bigInt({ min: 1n, max: MAX_PRICE_TIYN });

describe("расчёт денег сделки (ТЗ п. 6)", () => {
  it("пример ТЗ: X = 1 500 000 ₸ → 1 530 000 / 1 440 000 / 90 000", () => {
    expect(computeDealMoney(kztToTiyn(1_500_000))).toEqual({
      priceTiyn: 150_000_000n,
      protectionTiyn: 3_000_000n,
      buyerTotalTiyn: 153_000_000n,
      guaranteeTiyn: 6_000_000n,
      payoutTiyn: 144_000_000n,
      platformIncomeTiyn: 9_000_000n,
    });
  });

  it("пример ТЗ п. 4.1: X = 1 650 000 ₸ → выплачено мастеру 1 584 000 ₸, защита 33 000 ₸", () => {
    const money = computeDealMoney(kztToTiyn(1_650_000));
    expect(money.payoutTiyn).toBe(kztToTiyn(1_584_000));
    expect(money.protectionTiyn).toBe(kztToTiyn(33_000));
  });

  it("защита округляется вверх, выплата — вниз до тиына", () => {
    // 2% от 101 тиына = 2,02 → 3; 96% от 101 = 96,96 → 96.
    expect(computeDealMoney(101n)).toMatchObject({ protectionTiyn: 3n, payoutTiyn: 96n, guaranteeTiyn: 5n, platformIncomeTiyn: 8n });
  });

  it("цена ≤ 0 или больше потолка — ошибка, а не странная сумма", () => {
    expect(() => computeDealMoney(0n)).toThrow();
    expect(() => computeDealMoney(-5n)).toThrow();
    expect(() => computeDealMoney(MAX_PRICE_TIYN + 1n)).toThrow();
  });

  it("свойство: оплачено = выплата мастеру + доход платформы, до тиына", () => {
    fc.assert(
      fc.property(price, (x) => {
        const m = computeDealMoney(x);
        return m.buyerTotalTiyn === m.payoutTiyn + m.platformIncomeTiyn && m.buyerTotalTiyn === x + m.protectionTiyn && m.payoutTiyn === x - m.guaranteeTiyn;
      }),
    );
  });

  it("свойство: защита — наименьшее целое ≥ 2% X, выплата — наибольшее целое ≤ 96% X", () => {
    fc.assert(
      fc.property(price, (x) => {
        const m = computeDealMoney(x);
        const p = m.protectionTiyn * 100n;
        const o = m.payoutTiyn * 100n;
        return p >= x * 2n && p - 100n < x * 2n && o <= x * 96n && o + 100n > x * 96n;
      }),
    );
  });

  it("свойство: доход платформы в пределах 6% X ± 2 тиына округления", () => {
    fc.assert(
      fc.property(price, (x) => {
        const income = computeDealMoney(x).platformIncomeTiyn * 100n;
        return income >= x * 6n && income < x * 6n + 200n;
      }),
    );
  });
});

describe("раздел по спору (ADR-009, OPEN_QUESTIONS №38)", () => {
  const paid = (x: bigint) => computeDealMoney(x).buyerTotalTiyn;

  it("мастеру вся цена — то же, что обычная выплата, возврат 0", () => {
    const x = kztToTiyn(1_500_000);
    expect(computeSplit(x, x)).toEqual({ masterTiyn: 144_000_000n, platformTiyn: 9_000_000n, refundTiyn: 0n });
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
