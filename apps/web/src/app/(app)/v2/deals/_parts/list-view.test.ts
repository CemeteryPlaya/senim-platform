import { describe, expect, it } from "vitest";
import type { DealStatus } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import type { NextStep } from "@/modules/deal-core";
import type { MoneyBlock } from "@/modules/payments";
import { dealListView, type ListDealInput } from "./list-view";

const t = ru.app.deal.list;

const awaiting: MoneyBlock = { kind: "awaiting", payment: "none", bankBalanceTiyn: 0n, isTest: false };
const held: MoneyBlock = { kind: "protected", amountTiyn: 102_000_00n, reservedAt: new Date(), operationRef: null, bankBalanceTiyn: 102_000_00n, isTest: false };

const deal = (id: string, status: DealStatus, over: Partial<ListDealInput> = {}): ListDealInput => ({
  id,
  title: `Заказ ${id}`,
  status,
  hasOpenDispute: false,
  money: status === "CREATED" ? awaiting : held,
  estimate: { totalTiyn: 102_000_00n },
  ...over,
});
const none = new Map<string, NextStep>();

describe("dealListView", () => {
  it("сделок нет — обучающий экран, без чипов", () => {
    expect(dealListView([], none, undefined)).toEqual({ group: "active", chips: [], cards: [], empty: "none" });
  });

  it("группы: «Идут» — до выплаты включительно, «Завершены» — завершённые, отменённые, с возвратом; по умолчанию «Идут»", () => {
    const deals = [deal("a", "CREATED"), deal("b", "ACCEPTED"), deal("c", "SPLIT_PAYOUT"), deal("d", "CANCELLED"), deal("e", "REFUNDED")];
    const view = dealListView(deals, none, undefined);
    expect(view.group).toBe("active");
    expect(view.cards.map((c) => c.id)).toEqual(["a", "b"]);
    expect(view.chips).toEqual([
      { href: "/v2/deals?group=active", label: t.groups.active(2), active: true },
      { href: "/v2/deals?group=done", label: t.groups.done(3), active: false },
    ]);
    expect(dealListView(deals, none, "done").cards.map((c) => c.id)).toEqual(["c", "d", "e"]);
  });

  it("идущих нет — сразу «Завершены»; выбранная пустая группа — пустая строка, а не обучающий экран", () => {
    expect(dealListView([deal("c", "SPLIT_PAYOUT")], none, undefined).group).toBe("done");
    expect(dealListView([deal("c", "SPLIT_PAYOUT")], none, "active")).toMatchObject({ group: "active", cards: [], empty: "group" });
  });

  it("карточка: адрес, статус, ход, деньги из журнала, признак «нужно ваше действие»", () => {
    const nexts = new Map<string, NextStep>([["a", { action: "pay", mine: true }]]);
    const [card] = dealListView([deal("a", "CREATED")], nexts, undefined).cards;
    expect(card).toMatchObject({
      href: "/v2/deals/a",
      chip: { text: ru.app.deal.status.CREATED, tone: "warn" },
      progress: { kind: "steps", done: 0, total: 5 },
      money: { amountTiyn: 102_000_00n, label: ru.common.home.client.toPay },
      mine: t.mine.pay,
    });
  });

  it("ждём другую сторону — признака нет, тон по статусу; оплачено — «в банке под защитой»", () => {
    const nexts = new Map<string, NextStep>([["b", { action: "waitReady", mine: false }]]);
    const [card] = dealListView([deal("b", "IN_PROGRESS")], nexts, undefined).cards;
    expect(card).toMatchObject({ chip: { tone: "accent" }, mine: null, money: { amountTiyn: 102_000_00n, label: ru.common.home.client.inBank } });
  });

  it("спор — плашка «Открыт спор», ход остановлен", () => {
    const [card] = dealListView([deal("s", "READY", { hasOpenDispute: true })], none, undefined).cards;
    expect(card).toMatchObject({ chip: { text: ru.app.deal.status.dispute, tone: "warn" }, progress: { kind: "stopped" } });
  });

  it("признак — только для действий покупателя; «что дальше» неизвестно — признака нет", () => {
    for (const [action, text] of [["signContract", t.mine.signContract], ["signAct", t.mine.signAct], ["leaveReview", t.mine.leaveReview]] as const) {
      const [card] = dealListView([deal("x", "READY")], new Map([["x", { action, mine: true }]]), undefined).cards;
      expect(card?.mine).toBe(text);
    }
    expect(dealListView([deal("x", "READY")], none, undefined).cards[0]?.mine).toBeNull();
  });
});
