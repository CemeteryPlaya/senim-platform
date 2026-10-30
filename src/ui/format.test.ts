import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatMoney, formatRelative, formatTime } from "./format";

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
