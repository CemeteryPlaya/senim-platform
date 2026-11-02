import { describe, expect, it } from "vitest";
import { financeState, monthEarnings, monthOf, parseMonth, type FinanceRow } from "./finance";

const base = { payment: "DUE", dealStatus: "IN_PROGRESS", stageStatus: "PENDING", paymentDue: "ON_ACCEPTANCE", previousDone: true } as const;

describe("состояние оплаты этапа для исполнителя", () => {
  it("полученное остаётся полученным при любом исходе сделки", () => {
    for (const dealStatus of ["IN_PROGRESS", "COMPLETED", "TERMINATED", "CANCELLED"] as const) {
      expect(financeState({ ...base, payment: "CONFIRMED", dealStatus })).toBe("received");
    }
  });

  it("неоплаченное по отменённой или расторгнутой сделке не ждём", () => {
    expect(financeState({ ...base, dealStatus: "CANCELLED" })).toBeNull();
    expect(financeState({ ...base, dealStatus: "TERMINATED", stageStatus: "ACCEPTED" })).toBeNull();
  });

  it("принятая работа и аванс к началу этапа — ожидаются, в том числе во время спора", () => {
    expect(financeState({ ...base, stageStatus: "ACCEPTED" })).toBe("expected");
    expect(financeState({ ...base, stageStatus: "ACCEPTED", dealStatus: "DISPUTE" })).toBe("expected");
    expect(financeState({ ...base, paymentDue: "ON_START" })).toBe("expected");
    expect(financeState({ ...base, payment: "MARKED_PAID", stageStatus: "ACCEPTED" })).toBe("expected");
  });

  it("работа не принята, аванс до приёмки предыдущего этапа, договор не подписан — впереди", () => {
    expect(financeState({ ...base, stageStatus: "SUBMITTED" })).toBe("upcoming");
    expect(financeState({ ...base, paymentDue: "ON_START", previousDone: false })).toBe("upcoming");
    expect(financeState({ ...base, paymentDue: "ON_START", dealStatus: "AWAITING_SIGNATURES" })).toBe("upcoming");
  });
});

describe("месяц по времени Алматы", () => {
  it("полночь по Алматы (UTC+5) — начало нового месяца", () => {
    expect(monthOf(new Date("2026-10-31T18:59:59Z"))).toBe("2026-10");
    expect(monthOf(new Date("2026-10-31T19:00:00Z"))).toBe("2026-11");
    expect(monthOf(new Date("2026-12-31T19:00:00Z"))).toBe("2027-01");
  });

  it("месяц из адреса: только ГГГГ-ММ", () => {
    expect(parseMonth("2026-11")).toBe("2026-11");
    expect(parseMonth("2026-01")).toBe("2026-01");
    for (const bad of [undefined, "", "2026-13", "2026-00", "2026-1", "26-11", "2026-11-01", "ноябрь"]) expect(parseMonth(bad)).toBeNull();
  });
});

describe("заработок за месяц", () => {
  const now = new Date("2026-11-15T07:00:00Z");
  let n = 0;
  const received = (iso: string, amount: number): FinanceRow => ({
    stageId: `s${++n}`,
    dealId: "d",
    dealNumber: 1,
    dealTitle: "Кухня",
    stageOrder: n,
    stageTitle: "Этап",
    amount,
    paymentDue: "ON_ACCEPTANCE",
    payment: "CONFIRMED",
    mode: "MANUAL",
    state: "received",
    date: new Date(iso),
  });
  const waiting: FinanceRow = { ...received("2026-11-10T07:00:00Z", 999), state: "expected", payment: "MARKED_PAID" };
  const rows = [received("2026-08-20T07:00:00Z", 30_000), received("2026-11-02T07:00:00Z", 50_000), received("2026-11-10T07:00:00Z", 20_000), waiting];

  it("по умолчанию — текущий месяц: только полученное, новые сверху, и сколько было в прошлом", () => {
    const m = monthEarnings(rows, null, now);
    expect(m).toMatchObject({ month: "2026-11", received: 70_000, previous: 0, prev: "2026-10", next: null });
    expect(m.rows.map((r) => r.amount)).toEqual([20_000, 50_000]);
  });

  it("пустые месяцы между оплатами — нули, по ним можно пройти до первой оплаты", () => {
    expect(monthEarnings(rows, "2026-10", now)).toMatchObject({ received: 0, previous: 0, rows: [], prev: "2026-09", next: "2026-11" });
    expect(monthEarnings(rows, "2026-09", now)).toMatchObject({ received: 0, previous: 30_000, prev: "2026-08", next: "2026-10" });
    expect(monthEarnings(rows, "2026-08", now)).toMatchObject({ received: 30_000, previous: 0, prev: null, next: "2026-09" });
  });

  it("месяц вне промежутка — ближайший край: будущее — текущий, раньше первой оплаты — её месяц", () => {
    expect(monthEarnings(rows, "2027-03", now).month).toBe("2026-11");
    expect(monthEarnings(rows, "2025-01", now).month).toBe("2026-08");
  });

  it("оплат не было — только текущий месяц с нулём", () => {
    expect(monthEarnings([waiting], "2026-05", now)).toEqual({ month: "2026-11", received: 0, previous: 0, rows: [], prev: null, next: null });
  });
});
