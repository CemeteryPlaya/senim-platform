import { describe, expect, it } from "vitest";
import { daysLeft, plannedReadyAt, type ScheduleInput } from "./schedule";

const signedAt = new Date("2026-04-01T10:00:00Z");
const base = (over: Partial<ScheduleInput> = {}): ScheduleInput => ({
  paymentMode: "MANUAL",
  signedAt,
  durationDays: 25,
  totalAmount: 1_000_000,
  deposits: [],
  ...over,
});
const deposit = (amount: number, completedAt: string, status: "SUCCEEDED" | "FAILED" | "PENDING" = "SUCCEEDED") => ({
  status,
  amount,
  completedAt: new Date(completedAt),
});

describe("плановая готовность — срок договора (п. 2.2) от даты начала", () => {
  it("оплата по этапам: срок считается с подписания договора обеими сторонами", () => {
    expect(plannedReadyAt(base())).toEqual(new Date("2026-04-26T10:00:00Z"));
  });

  it("договор ещё не подписан — даты нет", () => {
    expect(plannedReadyAt(base({ signedAt: null }))).toBeNull();
  });

  it("эскроу: срок идёт с поступления всей цены договора на счёт", () => {
    const deposits = [deposit(400_000, "2026-04-03T09:00:00Z"), deposit(600_000, "2026-04-05T09:00:00Z"), deposit(1, "2026-04-02T09:00:00Z", "FAILED")];
    expect(plannedReadyAt(base({ paymentMode: "ESCROW_SIMULATOR", deposits }))).toEqual(new Date("2026-04-30T09:00:00Z"));
  });

  it("эскроу пополнен не полностью — даты нет", () => {
    expect(plannedReadyAt(base({ paymentMode: "BANK", deposits: [deposit(999_999, "2026-04-03T09:00:00Z")] }))).toBeNull();
  });
});

describe("сколько дней осталось", () => {
  const ready = new Date("2026-04-26T10:00:00Z");
  it("округляет вверх неполный день", () => {
    expect(daysLeft(ready, new Date("2026-04-13T12:00:00Z"))).toBe(13);
  });
  it("срок прошёл или наступил — null", () => {
    expect(daysLeft(ready, ready)).toBeNull();
    expect(daysLeft(ready, new Date("2026-05-01T00:00:00Z"))).toBeNull();
  });
});
