import { describe, expect, it } from "vitest";
import { financeState } from "./finance";

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
