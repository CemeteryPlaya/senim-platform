import { describe, expect, it } from "vitest";
import { checkTransition, DEAL_STATUSES, DEAL_TRANSITIONS, DISPUTABLE, findTransition, type DealContext, type Who } from "./transitions";

const WHO: Who[] = ["CLIENT", "EXECUTOR", "OPERATOR", "SYSTEM"];

const base: DealContext = {
  signed: true,
  actSigned: false,
  openDispute: false,
  disputeOutcome: null,
  money: { hold: "none", exitRequested: false, payoutSettled: false, refundSettled: false },
};
type Patch = Omit<Partial<DealContext>, "money"> & { money?: Partial<DealContext["money"]> };
const ctx = (patch: Patch = {}): DealContext => ({ ...base, ...patch, money: { ...base.money, ...patch.money } });

/** Контекст, при котором условие разрешённого перехода выполнено. */
const SATISFIED: Record<string, DealContext> = {
  "CREATED>PAID_HOLD": ctx({ money: { hold: "SUCCEEDED" } }),
  "CREATED>CANCELLED": ctx(),
  "PAID_HOLD>IN_PROGRESS": ctx({ money: { hold: "SUCCEEDED" } }),
  "PAID_HOLD>REFUNDED": ctx({ money: { hold: "SUCCEEDED", exitRequested: true, refundSettled: true } }),
  "PAID_HOLD>SPLIT_PAYOUT": ctx({ disputeOutcome: "PARTIAL_SPLIT", money: { hold: "SUCCEEDED", exitRequested: true, payoutSettled: true } }),
  "IN_PROGRESS>READY": ctx({ money: { hold: "SUCCEEDED" } }),
  "IN_PROGRESS>REFUNDED": ctx({ disputeOutcome: "FULL_REFUND", money: { hold: "SUCCEEDED", exitRequested: true, refundSettled: true } }),
  "IN_PROGRESS>SPLIT_PAYOUT": ctx({ disputeOutcome: "PARTIAL_SPLIT", money: { hold: "SUCCEEDED", exitRequested: true, payoutSettled: true } }),
  "READY>ACCEPTED": ctx({ actSigned: true, money: { hold: "SUCCEEDED" } }),
  "READY>REFUNDED": ctx({ disputeOutcome: "FULL_REFUND", money: { hold: "SUCCEEDED", exitRequested: true, refundSettled: true } }),
  "READY>SPLIT_PAYOUT": ctx({ disputeOutcome: "PARTIAL_SPLIT", money: { hold: "SUCCEEDED", exitRequested: true, payoutSettled: true } }),
  "ACCEPTED>SPLIT_PAYOUT": ctx({ actSigned: true, money: { hold: "SUCCEEDED", exitRequested: true, payoutSettled: true } }),
};

/** Таблица ADR-009 раздел 2 — кто выполняет каждый разрешённый переход. */
const ADR_WHO: Record<string, Who[]> = {
  "CREATED>PAID_HOLD": ["SYSTEM"],
  "CREATED>CANCELLED": ["CLIENT", "EXECUTOR"],
  "PAID_HOLD>IN_PROGRESS": ["EXECUTOR"],
  "PAID_HOLD>REFUNDED": ["SYSTEM"],
  "PAID_HOLD>SPLIT_PAYOUT": ["SYSTEM"],
  "IN_PROGRESS>READY": ["EXECUTOR"],
  "IN_PROGRESS>REFUNDED": ["SYSTEM"],
  "IN_PROGRESS>SPLIT_PAYOUT": ["SYSTEM"],
  "READY>ACCEPTED": ["SYSTEM"],
  "READY>REFUNDED": ["SYSTEM"],
  "READY>SPLIT_PAYOUT": ["SYSTEM"],
  "ACCEPTED>SPLIT_PAYOUT": ["SYSTEM"],
};

describe("таблица переходов сделки — ровно ADR-009", () => {
  it("12 разрешённых пар, кто — по ADR, у каждой есть описание и проверенный контекст", () => {
    expect(Object.fromEntries(DEAL_TRANSITIONS.map((t) => [`${t.from}>${t.to}`, [...t.who]]))).toEqual(ADR_WHO);
    expect(Object.keys(SATISFIED).sort()).toEqual(Object.keys(ADR_WHO).sort());
    for (const t of DEAL_TRANSITIONS) expect(t.when.length).toBeGreaterThan(10);
  });

  it("спор открывается с PAID_HOLD по READY включительно", () => {
    expect(DISPUTABLE).toEqual(["PAID_HOLD", "IN_PROGRESS", "READY"]);
  });

  describe.each(DEAL_STATUSES.flatMap((from) => DEAL_STATUSES.map((to) => [from, to] as const)))("%s → %s", (from, to) => {
    const row = findTransition(from, to);
    if (!row) {
      it("запрещён для всех при любом контексте", () => {
        for (const who of WHO) for (const c of Object.values(SATISFIED)) expect(checkTransition(from, to, who, c)).toBe("notAllowedNow");
      });
      return;
    }
    const ok = SATISFIED[`${from}>${to}`];
    it(`разрешён: ${row.who.join(", ")}`, () => {
      for (const who of row.who) expect(checkTransition(from, to, who, ok)).toBeNull();
    });
    it("другим — «не ваше действие»", () => {
      for (const who of WHO.filter((w) => !row.who.includes(w))) expect(checkTransition(from, to, who, ok)).toBe("notYourAction");
    });
    it("при открытом споре — запрещён", () => {
      expect(checkTransition(from, to, row.who[0], { ...ok, openDispute: true })).toBe("disputeOpen");
    });
    it("без своего условия — запрещён", () => {
      // Ни одно условие не выполнено: оферта не подписана, оплата в банке, деньги уходят, акта нет, итогов нет.
      expect(checkTransition(from, to, row.who[0], ctx({ signed: false, money: { hold: "PENDING", exitRequested: true } }))).not.toBeNull();
    });
  });
});

describe("условия", () => {
  it("оплата не двигает сделку без подписанной оферты", () => {
    expect(checkTransition("CREATED", "PAID_HOLD", "SYSTEM", ctx({ signed: false, money: { hold: "SUCCEEDED" } }))).toBe("notSigned");
    expect(checkTransition("CREATED", "PAID_HOLD", "SYSTEM", ctx({ money: { hold: "PENDING" } }))).toBe("holdNotSettled");
  });

  it("отмена до оплаты — нельзя, пока оплата в обработке; отклонённая оплата не мешает", () => {
    expect(checkTransition("CREATED", "CANCELLED", "CLIENT", ctx({ money: { hold: "PENDING" } }))).toBe("holdPending");
    expect(checkTransition("CREATED", "CANCELLED", "CLIENT", ctx({ money: { hold: "SUCCEEDED" } }))).toBe("holdPending");
    expect(checkTransition("CREATED", "CANCELLED", "EXECUTOR", ctx({ money: { hold: "FAILED" } }))).toBeNull();
  });

  it("деньги уходят (возврат/выплата запрошены) — начать и сдать нельзя", () => {
    expect(checkTransition("PAID_HOLD", "IN_PROGRESS", "EXECUTOR", ctx({ money: { exitRequested: true } }))).toBe("moneyLeaving");
    expect(checkTransition("IN_PROGRESS", "READY", "EXECUTOR", ctx({ money: { exitRequested: true } }))).toBe("moneyLeaving");
  });

  it("приёмка — только с подписанным актом", () => {
    expect(checkTransition("READY", "ACCEPTED", "SYSTEM", ctx())).toBe("actNotSigned");
  });

  it("возврат из работы — только по решению спора «полный возврат»", () => {
    const refunded = { money: { exitRequested: true, refundSettled: true } };
    expect(checkTransition("IN_PROGRESS", "REFUNDED", "SYSTEM", ctx(refunded))).toBe("notAllowedNow");
    expect(checkTransition("READY", "REFUNDED", "SYSTEM", ctx({ ...refunded, disputeOutcome: "PARTIAL_SPLIT" }))).toBe("notAllowedNow");
    expect(checkTransition("READY", "REFUNDED", "SYSTEM", ctx({ disputeOutcome: "FULL_REFUND", money: { exitRequested: true } }))).toBe("refundNotSettled");
  });

  it("выплата — только подтверждённая", () => {
    expect(checkTransition("ACCEPTED", "SPLIT_PAYOUT", "SYSTEM", ctx({ money: { exitRequested: true } }))).toBe("payoutNotSettled");
    expect(checkTransition("READY", "SPLIT_PAYOUT", "SYSTEM", ctx({ disputeOutcome: "PARTIAL_SPLIT" }))).toBe("payoutNotSettled");
  });
});
