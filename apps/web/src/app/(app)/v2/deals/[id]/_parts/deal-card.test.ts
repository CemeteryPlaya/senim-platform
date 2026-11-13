import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { formatMoney } from "@/kit";
import type { NextAction } from "@/modules/deal-core";
import type { MoneyBlock, MoneyView } from "@/modules/payments";
import { cancelText, documentRows, HISTORY_SHOWN, historyView, moneyView, nowView, orderRows, type NowInput, type NowKind } from "./deal-card";

const t = ru.app.deal.card;
const n = t.now;

const base: NowInput = {
  id: "d1",
  next: { action: "none", mine: false },
  contractId: "c1",
  actId: "a1",
  payTiyn: 102_000_00n,
  bank: null,
  plannedReadyAt: null,
  needsPosition: false,
  refundAll: true,
};
const now = (action: NextAction, mine: boolean, over: Partial<NowInput> = {}) => nowView({ ...base, next: { action, mine }, ...over });

/**
 * Таблица «что сейчас» — по строке на каждое значение `next.action` модуля (deal-core/next-step.ts), которое видит
 * покупатель, плюс состояния Review Focus (спор, отмена, возврат, ожидание другой стороны, ожидание подтверждения оплаты,
 * завершена) и шаги чужих ролей.
 */
const TABLE: { name: string; action: NextAction; mine: boolean; over?: Partial<NowInput>; kind: NowKind; title: string; primary: { label: string; href: string } | null }[] = [
  { name: "подписать оферту", action: "signContract", mine: true, kind: "sign-offer", title: n.signOffer.title, primary: { label: n.signOffer.action, href: "/v2/deals/d1/sign/c1" } },
  { name: "оферты нет — кнопки нет", action: "signContract", mine: true, over: { contractId: null }, kind: "unknown", title: n.unknown.title, primary: null },
  { name: "ждём подпись оферты мастером (другая сторона не подписала)", action: "waitContractSignature", mine: false, kind: "wait-offer", title: n.waitOffer.title, primary: null },
  { name: "оплатить: сумма к оплате в кнопке", action: "pay", mine: true, kind: "pay", title: n.pay.title, primary: { label: n.pay.action(formatMoney(102_000_00n)), href: "/v2/deals/d1/pay" } },
  { name: "оплатить без своей отметки банку — всё равно на экран оплаты (отметка там)", action: "pay", mine: true, over: { bank: { mine: false, other: true } }, kind: "pay", title: n.pay.title, primary: { label: n.pay.action(formatMoney(102_000_00n)), href: "/v2/deals/d1/pay" } },
  { name: "оплата закрыта: нет отметки мастера", action: "pay", mine: true, over: { bank: { mine: true, other: false } }, kind: "pay-wait-master", title: n.payWaitMaster.title, primary: null },
  { name: "оплата ждёт подтверждения (ручной провайдер)", action: "waitPaymentConfirmation", mine: false, kind: "pay-pending", title: n.payPending.title, primary: null },
  { name: "ждём начала работ", action: "waitStart", mine: false, kind: "wait-start", title: n.waitStart.title, primary: null },
  { name: "ждём готовности", action: "waitReady", mine: false, kind: "wait-ready", title: n.waitReady.title, primary: null },
  { name: "принять мебель (акт)", action: "signAct", mine: true, kind: "accept", title: n.accept.title, primary: { label: n.accept.action, href: "/v2/deals/d1/sign/a1" } },
  { name: "акта нет — кнопки нет", action: "signAct", mine: true, over: { actId: null }, kind: "unknown", title: n.unknown.title, primary: null },
  { name: "ждём подпись акта мастером", action: "waitMasterActSignature", mine: false, kind: "wait-act", title: n.waitAct.title, primary: null },
  { name: "банк проводит выплату", action: "waitPayout", mine: false, kind: "wait-payout", title: n.waitPayout.title, primary: null },
  { name: "банк возвращает деньги целиком (отмена после оплаты)", action: "waitRefund", mine: false, kind: "wait-refund", title: n.waitRefund.title, primary: null },
  { name: "деньги уходят частями по решению спора", action: "waitRefund", mine: false, over: { refundAll: false }, kind: "wait-settlement", title: n.waitSettlement.title, primary: null },
  { name: "открыт спор: без главной кнопки", action: "waitDispute", mine: false, kind: "dispute", title: n.dispute.title, primary: null },
  { name: "оставить отзыв", action: "leaveReview", mine: true, kind: "review", title: n.review.title, primary: { label: n.review.action, href: "/v2/deals/d1/review" } },
  { name: "сделка завершена", action: "done", mine: false, kind: "done", title: n.done.title, primary: null },
  { name: "отменена", action: "cancelled", mine: false, kind: "cancelled", title: n.cancelled.title, primary: null },
  { name: "возвращена", action: "refunded", mine: false, kind: "refunded", title: n.refunded.title, primary: null },
  // Шаги мастера и оператора: покупателю модуль их не отдаёт; если вдруг — без кнопки.
  ...(["waitPayment", "startWork", "submitReady", "signActEcp", "waitAct", "resolveDispute", "none"] as const).map((action) => ({
    name: `чужой шаг ${action}`,
    action,
    mine: action !== "waitPayment" && action !== "waitAct" && action !== "none",
    kind: "unknown" as const,
    title: n.unknown.title,
    primary: null,
  })),
];

describe("nowView: таблица «что сейчас» покупателя", () => {
  it.each(TABLE)("$name", ({ action, mine, over, kind, title, primary }) => {
    const view = nowView({ ...base, next: { action, mine }, ...over });
    expect(view.kind).toBe(kind);
    expect(view.title).toBe(title);
    expect(view.primary).toEqual(primary);
  });

  it("таблица покрывает каждое действие модуля", () => {
    const all: NextAction[] = [
      "signContract", "waitContractSignature", "pay", "waitPayment", "waitPaymentConfirmation", "startWork", "waitStart", "submitReady", "waitReady",
      "signAct", "signActEcp", "waitAct", "waitMasterActSignature", "waitPayout", "waitRefund", "waitDispute", "resolveDispute", "leaveReview", "done",
      "cancelled", "refunded", "none",
    ];
    expect(new Set(TABLE.map((r) => r.action))).toEqual(new Set(all));
  });

  it("главная кнопка — только у своего шага: чужой signContract/pay/signAct/leaveReview кнопки не даёт", () => {
    for (const action of ["signContract", "pay", "signAct"] as const) expect(now(action, false).primary).toBeNull();
    expect(now("leaveReview", false)).toMatchObject({ kind: "done", primary: null });
  });

  it("ждём готовности: ожидаемая дата, когда модуль её знает", () => {
    expect(now("waitReady", false, { plannedReadyAt: new Date("2026-12-20T10:00:00Z") }).body).toBe(n.waitReady.readyBy("20 декабря 2026"));
    expect(now("waitReady", false).body).toBe(n.waitReady.body);
  });

  it("спор: «Изложить свою позицию» — ссылкой на экран спора, только когда позиции ещё нет", () => {
    expect(now("waitDispute", false, { needsPosition: true }).link).toEqual({ label: n.dispute.position, href: "/v2/deals/d1/dispute" });
    expect(now("waitDispute", false).link).toBeNull();
    expect(now("waitDispute", false).body).toBe(n.dispute.body);
  });

  it("отмена и возврат объясняют, что с деньгами", () => {
    expect(now("cancelled", false).body).toBe(n.cancelled.body);
    expect(now("refunded", false).body).toBe(n.refunded.body);
    expect(now("waitRefund", false).body).toBe(n.waitRefund.body);
  });

  it("id в адресах экранируется", () => {
    expect(nowView({ ...base, id: "a/b", next: { action: "pay", mine: true } }).primary?.href).toBe("/v2/deals/a%2Fb/pay");
  });
});

const snapshot = { priceTiyn: 100_000_00n, protectionTiyn: 2_000_00n };
const estimate = { priceTiyn: 100_000_00n, extraTiyn: 2_000_00n, totalTiyn: 102_000_00n };
/** Блок денег журнала; пометка тестового платежа включена нарочно — экран её не показывает. */
const block = (view: MoneyView, bankBalanceTiyn = 0n): MoneyBlock => ({ ...view, bankBalanceTiyn, isTest: true });
const money = (b: MoneyBlock) => moneyView({ block: b, estimate, snapshot });

describe("moneyView: блок денег из журнала", () => {
  it("до оплаты: «К оплате» — итог сметы, строки цены и защиты (с пояснением) и итог; тон без зелёного", () => {
    const v = money(block({ kind: "awaiting", payment: "none" }));
    expect(v).toMatchObject({ tone: "awaiting", title: t.money.awaiting.title, amount: 102_000_00n, note: t.money.awaiting.note });
    expect(v.rows).toEqual([
      { label: "Цена по оферте", amount: 100_000_00n },
      { label: "Защита сделки (2%)", amount: 2_000_00n, explain: true },
      { label: t.money.total, amount: 102_000_00n, total: true },
    ]);
  });

  it("оплата в обработке и не прошла — свои заголовки, сумма та же", () => {
    expect(money(block({ kind: "awaiting", payment: "PENDING" }))).toMatchObject({ tone: "awaiting", title: t.money.pending.title, amount: 102_000_00n });
    expect(money(block({ kind: "awaiting", payment: "FAILED" }))).toMatchObject({ tone: "awaiting", title: t.money.failed.title, note: t.money.failed.note });
  });

  it("под защитой: единственный зелёный тон, сумма — зарезервированная в банке", () => {
    const v = money(block({ kind: "protected", amountTiyn: 102_000_00n, reservedAt: new Date(), operationRef: "X" }));
    expect(v).toMatchObject({ tone: "protected", title: "Деньги в банке под защитой", amount: 102_000_00n });
    expect(v.rows.map((r) => r.label)).toEqual(["Цена по оферте", "Защита сделки (2%)"]);
  });

  it("спор: выплата приостановлена, сумма — остаток в банке", () => {
    const v = money(block({ kind: "frozen", amountTiyn: 96_000_00n, frozenAt: new Date() }, 102_000_00n));
    expect(v).toMatchObject({ tone: "frozen", title: t.money.frozen.title, amount: 102_000_00n });
  });

  it("выплата: сумма мастеру, защита сделки и возврат части (если был)", () => {
    const pending = money(block({ kind: "completed", paidToMasterTiyn: 96_000_00n, protectionTiyn: 2_000_00n, refundedTiyn: 0n, settled: false, completedAt: null }));
    expect(pending).toMatchObject({ tone: "completed", title: t.money.completed.pending, amount: 96_000_00n });
    expect(pending.rows).toEqual([{ label: "Защита сделки (2%)", amount: 2_000_00n, explain: true }]);
    const split = money(block({ kind: "completed", paidToMasterTiyn: 48_000_00n, protectionTiyn: 1_000_00n, refundedTiyn: 51_000_00n, settled: true, completedAt: new Date() }));
    expect(split.title).toBe(t.money.completed.done);
    expect(split.rows.at(-1)).toEqual({ label: t.money.refundedRow, amount: 51_000_00n });
  });

  it("возврат: сумма возврата; идёт и завершён", () => {
    expect(money(block({ kind: "refunded", amountTiyn: 102_000_00n, settled: false, refundedAt: null }))).toMatchObject({ tone: "refunded", title: t.money.refunded.pending, amount: 102_000_00n });
    expect(money(block({ kind: "refunded", amountTiyn: 102_000_00n, settled: true, refundedAt: new Date() })).title).toBe(t.money.refunded.done);
  });

  it("пометки тестового платежа нет ни в одном тексте", () => {
    const blocks = [
      block({ kind: "awaiting", payment: "none" }),
      block({ kind: "protected", amountTiyn: 1n, reservedAt: new Date(), operationRef: null }),
      block({ kind: "refunded", amountTiyn: 1n, settled: true, refundedAt: new Date() }),
    ];
    for (const b of blocks) expect(JSON.stringify(money(b), (_k, v: unknown) => (typeof v === "bigint" ? String(v) : v))).not.toMatch(/тестов/i);
  });
});

describe("cancelText: последствия отмены по факту cancelDeal", () => {
  const protectedBlock = block({ kind: "protected", amountTiyn: 102_000_00n, reservedAt: new Date(), operationRef: null });
  it("до оплаты — денег не было", () => {
    expect(cancelText({ canCancel: true, status: "CREATED", block: block({ kind: "awaiting", payment: "none" }) })).toBe("Сделка будет отменена. Деньги не списывались.");
  });
  it("после оплаты — вся зарезервированная сумма вернётся на карту, включая защиту", () => {
    expect(cancelText({ canCancel: true, status: "PAID_HOLD", block: protectedBlock })).toBe(
      `Сделка будет отменена, ${formatMoney(102_000_00n)} вернутся на вашу карту — включая защиту сделки.`,
    );
  });
  it("отмена недоступна — пункта нет", () => {
    expect(cancelText({ canCancel: false, status: "CREATED", block: block({ kind: "awaiting", payment: "none" }) })).toBeNull();
    expect(cancelText({ canCancel: true, status: "IN_PROGRESS", block: protectedBlock })).toBeNull();
  });
});

describe("заказ, документы, история", () => {
  it("«Заказ»: что делаем, город, срок, гарантия; строки мастера нет", () => {
    const rows = orderRows({ title: "Кухня", executorLabel: "Исполнитель №4", city: "Астана", plannedReadyAt: null, signedAt: null, durationDays: 30, warrantyMonths: 12 });
    expect(rows.map((r) => r.label)).toEqual([t.order.what, "Город", "Срок изготовления", "Гарантия"]);
    expect(rows[0]?.value).toBe("Кухня");
    expect(JSON.stringify(rows)).not.toContain("Исполнитель");
  });

  it("документы: название с номером, «Ждёт вашей подписи», если не хватает вашей; ссылка — PDF модуля", () => {
    const rows = documentRows([
      { id: "c1", kind: "CONTRACT", number: "Д-1", status: "SIGNING", pdfUrl: "/api/documents/c1/pdf", signable: true, canSign: { hand: true, ecp: false } },
      { id: "a1", kind: "ACCEPTANCE_ACT", number: "А-1", status: "SIGNING", pdfUrl: "/api/documents/a1/pdf", signable: true, canSign: { hand: false, ecp: false } },
      { id: "m1", kind: "MONEY_STATEMENT", number: "В-1", status: "SIGNING", pdfUrl: "/api/documents/m1/pdf", signable: false, canSign: { hand: false, ecp: false } },
    ]);
    expect(rows).toEqual([
      { id: "c1", name: "Оферта №\u00a0Д-1", status: t.documents.yours, href: "/api/documents/c1/pdf" },
      { id: "a1", name: "Акт приёмки №\u00a0А-1", status: "Ждёт подписей", href: "/api/documents/a1/pdf" },
      { id: "m1", name: "Выписка по деньгам №\u00a0В-1", status: "Подпись не нужна", href: "/api/documents/m1/pdf" },
    ]);
  });

  it("история: свежие сверху, свёрнута до последних событий; неизвестное событие — общей подписью", () => {
    const events = Array.from({ length: HISTORY_SHOWN + 2 }, (_, i) => ({ id: `e${i}`, action: i === 0 ? "deal.created" : "x.unknown", createdAt: new Date(Date.UTC(2026, 10, 1 + i)) }));
    const short = historyView(events, false);
    expect(short.items).toHaveLength(HISTORY_SHOWN);
    expect(short.more).toBe(true);
    expect(short.items[0]?.title).toBe(t.history.other);
    const full = historyView(events, true);
    expect(full.items).toHaveLength(HISTORY_SHOWN + 2);
    expect(full.more).toBe(false);
    expect(full.items.at(-1)?.title).toBe(t.history.action["deal.created"]);
  });
});
