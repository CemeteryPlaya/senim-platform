/**
 * Деньги сделки по ТЗ п. 6 (ADR-009) — единственное место формул и округления. Только тиыны (bigint).
 *
 * Цена по оферте X. Покупатель платит X + защита 2% (вверх до тиына). Мастер получает X − гарантия 4%
 * (выплата — вниз до тиына). Доход платформы = оплачено − выплата: он поглощает округление,
 * поэтому «оплачено = выплата мастеру + доход платформы» верно до тиына всегда.
 */

export const PROTECTION_PERCENT = 2n;
export const GUARANTEE_PERCENT = 4n;

/** Правило округления — одно место (OPEN_QUESTIONS №37): поменять здесь, тесты покажут последствия. */
export const ROUNDING = { protection: "up", payout: "down" } as const;

/** Потолок цены сделки — 1 млрд ₸: защита от опечатки на порядок, не бизнес-ограничение. */
export const MAX_PRICE_TIYN = 100_000_000_000n;

export type DealMoney = {
  priceTiyn: bigint;
  protectionTiyn: bigint;
  buyerTotalTiyn: bigint;
  guaranteeTiyn: bigint;
  payoutTiyn: bigint;
  platformIncomeTiyn: bigint;
};

export type Split = { masterTiyn: bigint; platformTiyn: bigint; refundTiyn: bigint };

/** amount × percent / 100 с округлением вверх или вниз; amount ≥ 0. */
function percentOf(amount: bigint, percent: bigint, mode: "up" | "down"): bigint {
  const scaled = amount * percent;
  const whole = scaled / 100n;
  return mode === "up" && scaled % 100n !== 0n ? whole + 1n : whole;
}

function assertPrice(priceTiyn: bigint) {
  if (priceTiyn <= 0n || priceTiyn > MAX_PRICE_TIYN) throw new RangeError(`цена сделки вне диапазона: ${priceTiyn}`);
}

export function computeDealMoney(priceTiyn: bigint): DealMoney {
  assertPrice(priceTiyn);
  const protectionTiyn = percentOf(priceTiyn, PROTECTION_PERCENT, ROUNDING.protection);
  const payoutTiyn = percentOf(priceTiyn, 100n - GUARANTEE_PERCENT, ROUNDING.payout);
  const buyerTotalTiyn = priceTiyn + protectionTiyn;
  return {
    priceTiyn,
    protectionTiyn,
    buyerTotalTiyn,
    guaranteeTiyn: priceTiyn - payoutTiyn,
    payoutTiyn,
    platformIncomeTiyn: buyerTotalTiyn - payoutTiyn,
  };
}

/**
 * Раздел по спору: мастеру причитается часть Y цены X. Выплата и доход платформы считаются той же формулой
 * от Y, остаток оплаченного — возврат покупателю. Y = 0 — полный возврат (доход 0), Y = X — обычная выплата.
 */
export function computeSplit(priceTiyn: bigint, masterShareTiyn: bigint): Split {
  const paid = computeDealMoney(priceTiyn).buyerTotalTiyn;
  if (masterShareTiyn < 0n || masterShareTiyn > priceTiyn) throw new RangeError(`доля мастера вне 0…X: ${masterShareTiyn}`);
  if (masterShareTiyn === 0n) return { masterTiyn: 0n, platformTiyn: 0n, refundTiyn: paid };
  const share = computeDealMoney(masterShareTiyn);
  return {
    masterTiyn: share.payoutTiyn,
    platformTiyn: share.platformIncomeTiyn,
    refundTiyn: paid - share.payoutTiyn - share.platformIncomeTiyn,
  };
}

/** Целые тенге (поля вне платёжного пути, ввод в форме) → тиыны. Дробные тенге — ошибка ввода. */
export function kztToTiyn(kzt: number): bigint {
  if (!Number.isSafeInteger(kzt)) throw new RangeError(`сумма в тенге должна быть целой: ${kzt}`);
  return BigInt(kzt) * 100n;
}
