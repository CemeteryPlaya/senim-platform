import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatDays, formatMoney, formatMonths, formatRelative, formatTiyn, formatTime, formatYears, moneyBreakParts } from "./format";

const NBSP = " ";

describe("formatMoney", () => {
  it("разбивает тысячи неразрывным пробелом и ставит знак тенге", () => {
    expect(formatMoney(1_250_000)).toBe(`1${NBSP}250${NBSP}000${NBSP}₸`);
  });

  it("малые суммы и ноль", () => {
    expect(formatMoney(0)).toBe(`0${NBSP}₸`);
    expect(formatMoney(950)).toBe(`950${NBSP}₸`);
  });

  it("округляет до целых тенге", () => {
    expect(formatMoney(10_000.6)).toBe(`10${NBSP}001${NBSP}₸`);
  });

  it("отрицательная сумма — со знаком минус", () => {
    expect(formatMoney(-5_000)).toMatch(/^[-−]5\s000\s₸$/u);
  });
});

describe("moneyBreakParts — где крупная сумма может перейти на новую строку", () => {
  it("между группами разрядов; знак валюты остаётся с последней группой", () => {
    expect(moneyBreakParts(1_250_000)).toEqual([`1${NBSP}`, `250${NBSP}`, `000${NBSP}₸`]);
  });

  it("короткая сумма — одним куском", () => {
    expect(moneyBreakParts(950)).toEqual([`950${NBSP}₸`]);
  });

  it("куски вместе — ровно formatMoney", () => {
    expect(moneyBreakParts(10_005_000).join("")).toBe(formatMoney(10_005_000));
  });

  it("сумма в тиынах (bigint) — те же места переноса, тиыны остаются со знаком валюты", () => {
    expect(moneyBreakParts(102_000_050n)).toEqual([`1${NBSP}`, `020${NBSP}`, `000,50${NBSP}₸`]);
    expect(moneyBreakParts(102_000_050n).join("")).toBe(formatTiyn(102_000_050n));
  });
});

describe("даты по времени Астаны (UTC+5)", () => {
  // 31 декабря 2025, 20:30 UTC = 1 января 2026, 01:30 в Астане.
  const newYear = new Date("2025-12-31T20:30:00Z");

  it("formatDate — день, месяц словом, год", () => {
    expect(formatDate(newYear)).toBe("1 января 2026");
  });

  it("formatDateTime — дата и время", () => {
    expect(formatDateTime(newYear)).toBe("1 января 2026, 01:30");
  });

  it("formatTime — часы и минуты", () => {
    expect(formatTime(newYear)).toBe("01:30");
  });

  it("принимает ISO-строку", () => {
    expect(formatDate("2026-03-12T09:00:00Z")).toBe("12 марта 2026");
  });
});

describe("formatRelative", () => {
  const now = new Date("2026-03-12T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  it("меньше минуты — «сейчас»", () => {
    expect(formatRelative(ago(20_000), now)).toBe("сейчас");
  });

  it("минуты и часы назад", () => {
    expect(formatRelative(ago(5 * MIN), now)).toBe("5 минут назад");
    expect(formatRelative(ago(2 * HOUR), now)).toBe("2 часа назад");
  });

  it("вчера и дни назад", () => {
    expect(formatRelative(ago(DAY), now)).toBe("вчера");
    expect(formatRelative(ago(3 * DAY), now)).toBe("3 дня назад");
  });

  it("будущее — «через …»", () => {
    expect(formatRelative(new Date(now.getTime() + 5 * DAY), now)).toBe("через 5 дней");
  });

  it("дальше недели — обычная дата", () => {
    expect(formatRelative(ago(30 * DAY), now)).toBe("10 февраля 2026");
  });
});

describe("сроки полными словами со склонением", () => {
  it("дни: 1 день, 3 дня, 35 дней, 21 день, 11 дней", () => {
    expect(formatDays(1)).toBe(`1${NBSP}день`);
    expect(formatDays(3)).toBe(`3${NBSP}дня`);
    expect(formatDays(35)).toBe(`35${NBSP}дней`);
    expect(formatDays(21)).toBe(`21${NBSP}день`);
    expect(formatDays(11)).toBe(`11${NBSP}дней`);
  });

  it("месяцы: 1 месяц, 2 месяца, 18 месяцев, 24 месяца", () => {
    expect(formatMonths(1)).toBe(`1${NBSP}месяц`);
    expect(formatMonths(2)).toBe(`2${NBSP}месяца`);
    expect(formatMonths(18)).toBe(`18${NBSP}месяцев`);
    expect(formatMonths(24)).toBe(`24${NBSP}месяца`);
  });

  it("годы: 1 год, 4 года, 12 лет", () => {
    expect(formatYears(1)).toBe(`1${NBSP}год`);
    expect(formatYears(4)).toBe(`4${NBSP}года`);
    expect(formatYears(12)).toBe(`12${NBSP}лет`);
  });
});

describe("formatTiyn — деньги сделки в тиынах", () => {
  it("целые тенге — без тиынов, разряды неразрывным пробелом", () => {
    expect(formatTiyn(153_000_000n)).toBe("1 530 000 ₸");
  });

  it("тиыны — после запятой двумя знаками", () => {
    expect(formatTiyn(10_105n)).toBe("101,05 ₸");
    expect(formatTiyn(7n)).toBe("0,07 ₸");
  });

  it("отрицательная сумма — со знаком минус", () => {
    expect(formatTiyn(-150n)).toBe("−1,50 ₸");
  });
});
