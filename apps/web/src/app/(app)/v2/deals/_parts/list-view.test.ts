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
  paymentProvider: "MOCK",
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

  it("карточка: адрес, плашка по шагу, ход, деньги из журнала; признака «нужно ваше действие» отдельно нет — его говорит плашка", () => {
    const nexts = new Map<string, NextStep>([["a", { action: "pay", mine: true }]]);
    const [card] = dealListView([deal("a", "CREATED")], nexts, undefined).cards;
    expect(card).toEqual({
      id: "a",
      href: "/v2/deals/a",
      title: expect.any(String),
      chip: { text: ru.app.deal.status.pay, tone: "warn" },
      progress: { kind: "steps", caption: ru.app.deal.stepCaption(1, 5, ru.app.deal.steps[0]), done: 0, total: 5 },
      money: { amountTiyn: 102_000_00n, label: ru.app.deal.line.toPay },
    });
  });

  it("ждём другую сторону — плашка по шагу; оплачено — «в банке под защитой»", () => {
    const nexts = new Map<string, NextStep>([["b", { action: "waitReady", mine: false }]]);
    const [card] = dealListView([deal("b", "IN_PROGRESS")], nexts, undefined).cards;
    expect(card).toMatchObject({ chip: { text: ru.app.deal.status.inWork, tone: "accent" }, money: { amountTiyn: 102_000_00n, label: ru.app.deal.line.inBank } });
  });

  it("спор — плашка «Идёт спор», ход остановлен", () => {
    const [card] = dealListView([deal("s", "READY", { hasOpenDispute: true })], none, undefined).cards;
    expect(card).toMatchObject({ chip: { text: ru.app.deal.status.dispute, tone: "warn" }, progress: { kind: "stopped" } });
  });

  it("оплата закрыта до согласия мастера: плашка «Ждём согласие мастера», не оранжевая", () => {
    const nexts = new Map<string, NextStep>([["a", { action: "pay", mine: true }]]);
    const [card] = dealListView([deal("a", "CREATED")], nexts, undefined, new Set(["a"])).cards;
    expect(card?.chip).toEqual({ text: ru.app.deal.status.waitMasterBank, tone: "neutral" });
  });

  it("возврат: «N ₸ вернулись вам» (сумма отдельно), выплата — без суммы мастеру", () => {
    const refunded: MoneyBlock = { kind: "refunded", amountTiyn: 102_000_00n, settled: true, refundedAt: new Date(), bankBalanceTiyn: 0n, isTest: false };
    const [card] = dealListView([deal("r", "REFUNDED", { money: refunded })], none, undefined).cards;
    expect(card?.money).toEqual({ amountTiyn: 102_000_00n, label: ru.app.deal.line.refundDone });
    expect(card?.progress).toBeNull();
    const paidOut: MoneyBlock = { kind: "completed", paidToMasterTiyn: 96_000_00n, protectionTiyn: 2_000_00n, refundedTiyn: 0n, settled: true, completedAt: new Date(), bankBalanceTiyn: 0n, isTest: false };
    expect(dealListView([deal("c", "SPLIT_PAYOUT", { money: paidOut })], none, undefined).cards[0]?.money).toEqual({ amountTiyn: null, label: ru.app.deal.line.payoutDone });
  });
});

describe("dealListView мастера", () => {
  const tm = ru.app.master.deal;
  // Смета мастера: «вы получите» = цена − гарантия 4% (из модуля); суммы покупателя (102 000 ₸) в строке не появляются.
  const mine = (id: string, status: DealStatus, over: Partial<ListDealInput> = {}) => deal(id, status, { estimate: { totalTiyn: 96_000_00n }, ...over });

  it("карточка словами мастера: плашка шага мастера, «Оплата вам» в шагах, «вы получите» вместо сумм покупателя", () => {
    const nexts = new Map<string, NextStep>([["a", { action: "startWork", mine: true }]]);
    const [card] = dealListView([mine("a", "PAID_HOLD")], nexts, undefined, new Set(), "EXECUTOR").cards;
    expect(card).toMatchObject({
      href: "/v2/deals/a",
      chip: { text: tm.status.start, tone: "warn" },
      money: { amountTiyn: 96_000_00n, label: tm.line.protected },
    });
    expect(card?.progress).toMatchObject({ kind: "steps" });
  });

  it("оферта заключена, своего согласия для банка нет — «Дайте согласие для банка»", () => {
    const nexts = new Map<string, NextStep>([["a", { action: "waitPayment", mine: false }]]);
    const [card] = dealListView([mine("a", "CREATED")], nexts, undefined, new Set(["a"]), "EXECUTOR").cards;
    expect(card?.chip.text).toBe(tm.status.bankConsent);
    const [given] = dealListView([mine("a", "CREATED")], nexts, undefined, new Set(), "EXECUTOR").cards;
    expect(given?.chip.text).toBe(tm.status.waitPay);
  });

  it("спор — ход остановлен словами мастера, деньги без суммы", () => {
    const frozen: MoneyBlock = { kind: "frozen", amountTiyn: 102_000_00n, frozenAt: new Date(), bankBalanceTiyn: 102_000_00n, isTest: false };
    const [card] = dealListView([mine("a", "IN_PROGRESS", { hasOpenDispute: true, money: frozen })], none, undefined, new Set(), "EXECUTOR").cards;
    expect(card?.progress).toEqual({ kind: "stopped", label: tm.stopped.dispute });
    expect(card?.money).toEqual({ amountTiyn: null, label: tm.line.frozen });
  });
});
