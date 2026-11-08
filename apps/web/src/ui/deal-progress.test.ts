import { describe, expect, it } from "vitest";
import { dealProgressView } from "./deal-progress";

describe("dealProgressView — таблица спеки 8а", () => {
  it.each([
    ["CREATED", 0],
    ["PAID_HOLD", 1],
    ["IN_PROGRESS", 1],
    ["READY", 3],
    ["ACCEPTED", 4],
    ["SPLIT_PAYOUT", 5],
  ] as const)("%s → шаг %i", (status, current) => {
    expect(dealProgressView(status, false)).toEqual({ kind: "steps", current, muted: false });
  });

  it("CANCELLED и REFUNDED — плашка вместо шагов", () => {
    expect(dealProgressView("CANCELLED", false)).toEqual({ kind: "banner", tone: "cancelled" });
    expect(dealProgressView("REFUNDED", false)).toEqual({ kind: "banner", tone: "refunded" });
  });

  it("спор поверх PAID_HOLD и READY: шаги те же, но серые", () => {
    expect(dealProgressView("PAID_HOLD", true)).toEqual({ kind: "steps", current: 1, muted: true });
    expect(dealProgressView("READY", true)).toEqual({ kind: "steps", current: 3, muted: true });
  });

  it("у конечных статусов спор не меняет вид", () => {
    expect(dealProgressView("CANCELLED", true)).toEqual({ kind: "banner", tone: "cancelled" });
  });
});
