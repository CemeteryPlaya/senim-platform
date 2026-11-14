import { describe, expect, it } from "vitest";
import { masterFirstSteps, masterHome, shownDeals, MASTER_HREFS, type MasterDealInput, type MasterHomeInput } from "./master-home";

const deal = (over: Partial<MasterDealInput> = {}): MasterDealInput => ({
  id: "d1",
  title: "Кухня",
  status: "IN_PROGRESS",
  hasOpenDispute: false,
  next: { action: "submitReady", mine: true },
  consentMissing: false,
  ...over,
});
const input = (over: Partial<MasterHomeInput> = {}): MasterHomeInput => ({ deals: [], counters: [], freshCount: 0, docs: null, ...over });
const counter = { requestId: "r1", requestTitle: "Заявка №1: Кухня", amountTiyn: 100n };
const okDocs = { kyc: "VERIFIED", payoutSet: true } as const;

describe("главная мастера: приоритет «Сейчас»", () => {
  it("сделка ждёт моего действия важнее всего: акт, оферта, согласие банку, начало работы", () => {
    const all = input({ counters: [counter], freshCount: 3, docs: { kyc: "NOT_SUBMITTED", payoutSet: false } });
    const pick = (d: MasterDealInput) => masterHome({ ...all, deals: [d] }).now.kind;
    expect(pick(deal({ next: { action: "signActEcp", mine: true } }))).toBe("sign-act");
    expect(pick(deal({ status: "CREATED", next: { action: "signContract", mine: true } }))).toBe("sign-offer");
    expect(pick(deal({ status: "CREATED", next: { action: "waitPayment", mine: false }, consentMissing: true }))).toBe("bank-consent");
    expect(pick(deal({ status: "PAID_HOLD", next: { action: "startWork", mine: true } }))).toBe("start");
  });

  it("срочнее из двух сделок идёт первой; главное действие ведёт в сделку", () => {
    const view = masterHome(
      input({ deals: [deal({ id: "a", next: { action: "startWork", mine: true } }), deal({ id: "b", next: { action: "signActEcp", mine: true } })] }),
    );
    expect(view.now.kind).toBe("sign-act");
    expect(view.primary).toEqual({ kind: "signAct", href: "/v2/deals/b" });
  });

  it("завершённая сделка с «моим» шагом не считается", () => {
    expect(masterHome(input({ deals: [deal({ status: "SPLIT_PAYOUT", next: { action: "signActEcp", mine: true } })] })).now.kind).toBe("empty");
  });

  it("ответ покупателя в торге — выше новых заявок", () => {
    const view = masterHome(input({ counters: [counter], freshCount: 2 }));
    expect(view.now.kind).toBe("counter");
    expect(view.primary?.href).toBe("/v2/executor/requests/r1");
  });

  it("новые заявки — выше документов; главное действие — список новых", () => {
    const view = masterHome(input({ freshCount: 2, docs: { kyc: "NOT_SUBMITTED", payoutSet: false } }));
    expect(view.now).toMatchObject({ kind: "fresh", freshCount: 2 });
    expect(view.primary?.href).toBe(MASTER_HREFS.fresh);
  });

  it("документы: отказ, не загружены, счёт не указан, на проверке (без кнопки)", () => {
    const k = (docs: MasterHomeInput["docs"]) => masterHome(input({ docs }));
    expect(k({ kyc: "REJECTED", payoutSet: true }).now.kind).toBe("kyc-rejected");
    expect(k({ kyc: "NOT_SUBMITTED", payoutSet: false }).primary?.href).toBe(MASTER_HREFS.kyc);
    expect(k({ kyc: "VERIFIED", payoutSet: false }).primary?.href).toBe(MASTER_HREFS.payout);
    const pending = k({ kyc: "PENDING", payoutSet: true });
    expect(pending.now.kind).toBe("kyc-pending");
    expect(pending.primary).toBeNull();
  });

  it("идёт работа — без главной кнопки, ссылка на сделку; ничего нет — пусто со ссылкой на компанию", () => {
    const working = masterHome(input({ deals: [deal()], docs: okDocs }));
    expect(working.now.kind).toBe("in-work");
    expect(working.primary).toBeNull();
    expect(working.secondary?.href).toBe("/v2/deals/d1");
    const empty = masterHome(input({ docs: okDocs }));
    expect(empty.now.kind).toBe("empty");
    expect(empty.secondary?.href).toBe(MASTER_HREFS.company);
  });
});

describe("shownDeals", () => {
  const list = ["a", "b", "c", "d"].map((id) => ({ id }));
  it("до двух, сделка из «Сейчас» первая, остальное — «Все сделки»", () => {
    expect(shownDeals(list, "c")).toEqual({ shown: [{ id: "c" }, { id: "a" }], more: 2 });
    expect(shownDeals(list, null).shown.map((d) => d.id)).toEqual(["a", "b"]);
    expect(shownDeals(list.slice(0, 1), null).more).toBe(0);
  });
});

describe("masterFirstSteps", () => {
  const steps = (over: Partial<Parameters<typeof masterFirstSteps>[0]> = {}) => masterFirstSteps({ docs: okDocs, offered: false, primaryHref: null, ...over });

  it("документы не прочитались — шагов нет; всё сделано — шаги скрыты", () => {
    expect(steps({ docs: null })).toBeNull();
    expect(steps({ offered: true })).toBeNull();
  });

  it("документы: загружены (на проверке или проверены) — сделано; не загружены и отказ — нет", () => {
    expect(steps({ docs: { kyc: "PENDING", payoutSet: true } })?.documents.done).toBe(true);
    expect(steps({ docs: { kyc: "VERIFIED", payoutSet: true } })?.documents.done).toBe(true);
    expect(steps({ docs: { kyc: "NOT_SUBMITTED", payoutSet: true } })?.documents.done).toBe(false);
    expect(steps({ docs: { kyc: "REJECTED", payoutSet: true } })?.documents.done).toBe(false);
  });

  it("не сделанные шаги ведут на свои экраны; сделанные — без ссылки", () => {
    expect(steps({ docs: { kyc: "NOT_SUBMITTED", payoutSet: false } })).toEqual({
      documents: { done: false, href: "/v2/executor/profile/kyc" },
      payout: { done: false, href: "/v2/executor/profile/payout" },
      offer: { done: false, href: "/v2/executor/requests" },
    });
    expect(steps()?.documents).toEqual({ done: true });
  });

  it("шаг, на который ведёт главное действие «Сейчас», без ссылки: действие одно", () => {
    const view = masterHome(input({ docs: { kyc: "NOT_SUBMITTED", payoutSet: false } }));
    const first = steps({ docs: { kyc: "NOT_SUBMITTED", payoutSet: false }, primaryHref: view.primary?.href ?? null });
    expect(first?.documents).toEqual({ done: false });
    expect(first?.payout.href).toBe("/v2/executor/profile/payout");
  });
});
