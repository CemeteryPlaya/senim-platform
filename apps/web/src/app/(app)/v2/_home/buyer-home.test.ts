import { describe, expect, it } from "vitest";
import type { NextAction } from "@/modules/deal-core";
import {
  buyerHome,
  dealSteps,
  firstName,
  type HomeDealInput,
  type HomeInput,
  type HomeRequestInput,
  type NowKind,
  type PrimaryAction,
} from "./buyer-home";

const deal = (over: Partial<HomeDealInput> & { action?: NextAction; mine?: boolean } = {}): HomeDealInput => {
  const { action, mine = false, ...rest } = over;
  return {
    id: "d1",
    title: "Кухня",
    status: "CREATED",
    hasOpenDispute: false,
    paid: false,
    next: action ? { action, mine } : null,
    ...rest,
  };
};

const request = (over: Partial<HomeRequestInput> = {}): HomeRequestInput => ({
  id: "r1",
  number: 1,
  title: "Кухня",
  status: "OPEN",
  offersCount: 0,
  ...over,
});

type Case = {
  name: string;
  input: HomeInput;
  now: NowKind;
  primary: PrimaryAction["kind"] | null;
  href?: string;
  secondary?: string;
};

const CASES: Case[] = [
  { name: "ничего нет — заказать", input: { deals: [], requests: [] }, now: "empty", primary: "order", href: "/v2/requests/new" },
  { name: "сделки только завершённые, отзыв не нужен — заказать", input: { deals: [deal({ status: "SPLIT_PAYOUT", paid: true, action: "done" })], requests: [] }, now: "empty", primary: "order" },
  { name: "отменённая заявка — заказать", input: { deals: [], requests: [request({ status: "CANCELLED" })] }, now: "empty", primary: "order" },
  { name: "подписать оферту", input: { deals: [deal({ action: "signContract", mine: true })], requests: [] }, now: "sign-offer", primary: "signOffer", href: "/v2/deals/d1" },
  { name: "оплатить", input: { deals: [deal({ action: "pay", mine: true })], requests: [] }, now: "pay", primary: "pay", href: "/v2/deals/d1" },
  { name: "принять мебель", input: { deals: [deal({ status: "READY", paid: true, action: "signAct", mine: true })], requests: [] }, now: "accept", primary: "accept", href: "/v2/deals/d1" },
  { name: "оставить отзыв (сделка завершена)", input: { deals: [deal({ status: "SPLIT_PAYOUT", paid: true, action: "leaveReview", mine: true })], requests: [] }, now: "review", primary: "review", href: "/v2/deals/d1" },
  { name: "моё действие важнее предложений и черновика", input: { deals: [deal({ action: "pay", mine: true })], requests: [request({ offersCount: 3 }), request({ id: "r2", status: "DRAFT" })] }, now: "pay", primary: "pay" },
  { name: "оплата срочнее подписи оферты в другой сделке", input: { deals: [deal({ id: "a", action: "signContract", mine: true }), deal({ id: "b", action: "pay", mine: true })], requests: [] }, now: "pay", primary: "pay", href: "/v2/deals/b" },
  { name: "одинаково срочные — самая свежая (первая в списке)", input: { deals: [deal({ id: "a", action: "pay", mine: true }), deal({ id: "b", action: "pay", mine: true })], requests: [] }, now: "pay", primary: "pay", href: "/v2/deals/a" },
  { name: "сделка ждёт мастера — без главного действия", input: { deals: [deal({ status: "IN_PROGRESS", paid: true, action: "waitReady" })], requests: [] }, now: "deal-waiting", primary: null },
  { name: "ждём банк — без главного действия", input: { deals: [deal({ status: "ACCEPTED", paid: true, action: "waitPayout" })], requests: [] }, now: "deal-waiting", primary: null },
  { name: "ожидание сделки важнее заявки с предложениями", input: { deals: [deal({ status: "PAID_HOLD", paid: true, action: "waitStart" })], requests: [request({ offersCount: 2 })] }, now: "deal-waiting", primary: null },
  { name: "открытый спор — без главного действия", input: { deals: [deal({ status: "READY", paid: true, hasOpenDispute: true, action: "waitDispute" })], requests: [] }, now: "deal-dispute", primary: null },
  { name: "спор раньше обычного ожидания", input: { deals: [deal({ id: "a", status: "IN_PROGRESS", paid: true, action: "waitReady" }), deal({ id: "b", status: "READY", paid: true, hasOpenDispute: true, action: "waitDispute" })], requests: [] }, now: "deal-dispute", primary: null },
  { name: "моё действие важнее чужого спора", input: { deals: [deal({ id: "a", status: "READY", paid: true, hasOpenDispute: true, action: "waitDispute" }), deal({ id: "b", action: "pay", mine: true })], requests: [] }, now: "pay", primary: "pay", href: "/v2/deals/b" },
  { name: "не удалось прочитать «что дальше» — идёт, без кнопки", input: { deals: [deal({ status: "IN_PROGRESS", paid: true })], requests: [] }, now: "deal-waiting", primary: null },
  { name: "заявка с предложениями", input: { deals: [], requests: [request({ offersCount: 3 })] }, now: "offers", primary: "offers", href: "/v2/requests/r1" },
  { name: "предложения важнее черновика", input: { deals: [], requests: [request({ id: "d", status: "DRAFT" }), request({ id: "o", offersCount: 1 })] }, now: "offers", primary: "offers", href: "/v2/requests/o" },
  { name: "черновик", input: { deals: [], requests: [request({ id: "dr", status: "DRAFT" })] }, now: "draft", primary: "draft", href: "/v2/requests/new?draft=dr" },
  { name: "черновик важнее ожидания заявки", input: { deals: [], requests: [request({ id: "w" }), request({ id: "dr", status: "DRAFT" })] }, now: "draft", primary: "draft", href: "/v2/requests/new?draft=dr" },
  { name: "заявка без предложений — ждём, ссылка на заявку", input: { deals: [], requests: [request()] }, now: "request-waiting", primary: null, secondary: "/v2/requests/r1" },
  { name: "замер площадки — тоже ждём", input: { deals: [], requests: [request({ status: "PLATFORM_MEASURING" })] }, now: "request-waiting", primary: null, secondary: "/v2/requests/r1" },
  { name: "мастер выбран, сделки ещё нет", input: { deals: [], requests: [request({ status: "MEASURING", offersCount: 2 })] }, now: "request-chosen", primary: null, secondary: "/v2/requests/r1" },
];

describe("buyerHome: что сейчас", () => {
  it.each(CASES)("$name", ({ input, now, primary, href, secondary }) => {
    const view = buyerHome(input);
    expect(view.now.kind).toBe(now);
    expect(view.primary?.kind ?? null).toBe(primary);
    if (href) expect(view.primary?.href).toBe(href);
    expect(view.secondary?.href).toBe(secondary);
    // Главное действие и ссылка «второстепенное» не бывают вместе: на экране одно главное.
    expect(view.primary !== null && view.secondary !== null).toBe(false);
  });

  it("число предложений и заявка — в «Сейчас»", () => {
    const view = buyerHome({ deals: [], requests: [request({ id: "o", number: 7, offersCount: 4 })] });
    expect(view.now.offersCount).toBe(4);
    expect(view.now.request?.number).toBe(7);
  });

  it("что ждём — в «Сейчас» (подпись), неизвестное ожидание — общая", () => {
    expect(buyerHome({ deals: [deal({ status: "IN_PROGRESS", paid: true, action: "waitReady" })], requests: [] }).now.waitAction).toBe("waitReady");
    expect(buyerHome({ deals: [deal({ status: "IN_PROGRESS", paid: true, action: "none" })], requests: [] }).now.waitAction).toBeNull();
  });
});

describe("buyerHome: сделка и заявки ниже «Сейчас»", () => {
  it("карточка сделки — та, о которой «Сейчас»; остальные идущие — «Все сделки»", () => {
    const view = buyerHome({
      deals: [
        deal({ id: "a", status: "IN_PROGRESS", paid: true, action: "waitReady" }),
        deal({ id: "b", action: "pay", mine: true }),
        deal({ id: "c", status: "READY", paid: true, action: "waitMasterActSignature" }),
      ],
      requests: [],
    });
    expect(view.deal?.id).toBe("b");
    expect(view.moreDeals).toBe(2);
  });

  it("без срочного — самая свежая идущая; завершённые не считаются", () => {
    const view = buyerHome({
      deals: [deal({ id: "a", status: "SPLIT_PAYOUT", paid: true, action: "done" }), deal({ id: "b", status: "IN_PROGRESS", paid: true, action: "waitReady" })],
      requests: [],
    });
    expect(view.deal?.id).toBe("b");
    expect(view.moreDeals).toBe(0);
  });

  it("отзыв по завершённой сделке: карточка — она", () => {
    const view = buyerHome({ deals: [deal({ id: "a", status: "SPLIT_PAYOUT", paid: true, action: "leaveReview", mine: true })], requests: [] });
    expect(view.deal?.id).toBe("a");
    expect(view.moreDeals).toBe(0);
  });

  it("заявок не больше двух, заявка из «Сейчас» отдельно не повторяется, отменённые и закрытые не видны", () => {
    const view = buyerHome({
      deals: [],
      requests: [
        request({ id: "o", offersCount: 2 }),
        request({ id: "w1" }),
        request({ id: "w2", status: "MEASURING" }),
        request({ id: "w3" }),
        request({ id: "x", status: "CANCELLED" }),
        request({ id: "c", status: "CLOSED" }),
      ],
    });
    expect(view.now.request?.id).toBe("o");
    expect(view.requests.map((r) => r.id)).toEqual(["w1", "w2"]);
  });

  it("ожидание заявки: она в «Сейчас», а не вторым разом в списке", () => {
    const view = buyerHome({ deals: [], requests: [request({ id: "w1" })] });
    expect(view.requests).toEqual([]);
  });

  it("пусто — списка и сделки нет: пустое состояние не повторяется отдельной карточкой", () => {
    const view = buyerHome({ deals: [], requests: [] });
    expect(view.requests).toEqual([]);
    expect(view.deal).toBeNull();
    expect(view.moreDeals).toBe(0);
  });

  it("черновик, пока важнее другое, остаётся в списке", () => {
    const view = buyerHome({ deals: [deal({ action: "pay", mine: true })], requests: [request({ id: "dr", status: "DRAFT" })] });
    expect(view.requests.map((r) => r.id)).toEqual(["dr"]);
  });
});

describe("buyerHome: первые шаги", () => {
  it("новый человек: профиль пройден, дальше «Заказать мебель» со ссылкой", () => {
    const steps = buyerHome({ deals: [], requests: [] }).firstSteps;
    expect(steps?.order).toEqual({ done: false, href: "/v2/requests/new" });
    expect(steps?.master).toEqual({ done: false });
    expect(steps?.pay).toEqual({ done: false });
  });

  it("с заявкой: заказ сделан, мастера ещё выбирать — ссылка на заявки", () => {
    const steps = buyerHome({ deals: [], requests: [request()] }).firstSteps;
    expect(steps?.order.done).toBe(true);
    expect(steps?.master).toEqual({ done: false, href: "/v2/requests" });
  });

  it("черновик — ещё не заказ", () => {
    expect(buyerHome({ deals: [], requests: [request({ status: "DRAFT" })] }).firstSteps?.order.done).toBe(false);
  });

  it("со сделкой до оплаты: мастер выбран, оплата — ссылка на сделку", () => {
    const steps = buyerHome({ deals: [deal({ action: "pay", mine: true })], requests: [] }).firstSteps;
    expect(steps?.master.done).toBe(true);
    expect(steps?.pay).toEqual({ done: false, href: "/v2/deals/d1" });
  });

  it("есть оплаченная сделка — первых шагов нет", () => {
    expect(buyerHome({ deals: [deal({ status: "IN_PROGRESS", paid: true, action: "waitReady" })], requests: [] }).firstSteps).toBeNull();
  });
});

describe("dealSteps", () => {
  it.each([
    ["CREATED", ["current", "todo", "todo", "todo", "todo"]],
    ["PAID_HOLD", ["done", "current", "todo", "todo", "todo"]],
    ["IN_PROGRESS", ["done", "current", "todo", "todo", "todo"]],
    ["READY", ["done", "done", "done", "current", "todo"]],
    ["ACCEPTED", ["done", "done", "done", "done", "current"]],
    ["SPLIT_PAYOUT", ["done", "done", "done", "done", "done"]],
  ] as const)("%s", (status, states) => {
    expect(dealSteps(status, false)).toEqual({ kind: "steps", states });
  });

  it("спор, отмена, возврат — одна строка вместо шкалы", () => {
    expect(dealSteps("READY", true)).toEqual({ kind: "stopped", reason: "dispute" });
    expect(dealSteps("CANCELLED", false)).toEqual({ kind: "stopped", reason: "cancelled" });
    expect(dealSteps("REFUNDED", false)).toEqual({ kind: "stopped", reason: "refunded" });
  });
});

describe("firstName", () => {
  it.each([
    ["Иванов Иван Иванович", "Иван"],
    ["Иванов Иван", "Иван"],
    ["  Нурланова   Айгерим  ", "Айгерим"],
    ["ИВАНОВ ИВАН ИВАНОВИЧ", "Иван"],
    ["Иванова Нур-Султан", "Нур-Султан"],
    ["Иванов", null],
    ["", null],
    [null, null],
  ] as const)("%s → %s", (full, name) => {
    expect(firstName(full)).toBe(name);
  });
});
