import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { formatMoney } from "@/kit";
import type { NextAction } from "@/modules/deal-core";
import type { MoneyBlock, MoneyView } from "@/modules/payments";
import {
  cancelText,
  documentRows,
  HISTORY_SHOWN,
  historyView,
  masterMoneyView,
  moneyView,
  nowView,
  orderRows,
  reportsView,
  reviewRows,
  type HistoryEvent,
  type NowInput,
  type NowKind,
} from "./deal-card";

const t = ru.app.deal.card;
const n = t.now;

const base: NowInput = {
  id: "d1",
  side: "CLIENT",
  next: { action: "none", mine: false },
  contractId: "c1",
  actId: "a1",
  contractPdf: "/api/documents/c1/pdf",
  payTiyn: 102_000_00n,
  manual: false,
  bank: null,
  plannedReadyAt: null,
  needsPosition: false,
  refundAll: true,
  disputeOutcome: null,
};
const now = (action: NextAction, mine: boolean, over: Partial<NowInput> = {}) => nowView({ ...base, next: { action, mine }, ...over });
const pay = { label: n.pay.action(formatMoney(102_000_00n)), href: "/v2/deals/d1/pay" };

/**
 * Таблица «что сейчас» — по строке на каждое значение `next.action` модуля (deal-core/next-step.ts), которое видит
 * покупатель, плюс состояния Review Focus (спор, отмена, возврат, ожидание другой стороны, ожидание подтверждения оплаты,
 * завершена), ручной провайдер, решённый спор и шаги чужих ролей.
 */
const TABLE: { name: string; action: NextAction; mine: boolean; over?: Partial<NowInput>; kind: NowKind; title: string; primary: { label: string; href: string } | null }[] = [
  { name: "подписать оферту", action: "signContract", mine: true, kind: "sign-offer", title: n.signOffer.title, primary: { label: n.signOffer.action, href: "/v2/deals/d1/sign/c1" } },
  { name: "оферты нет — кнопки нет", action: "signContract", mine: true, over: { contractId: null }, kind: "unknown", title: n.unknown.title, primary: null },
  { name: "ждём подпись оферты мастером (другая сторона не подписала)", action: "waitContractSignature", mine: false, kind: "wait-offer", title: n.waitOffer.title, primary: null },
  { name: "оплатить: сумма к оплате в кнопке", action: "pay", mine: true, kind: "pay", title: n.pay.title, primary: pay },
  { name: "оплатить без своей отметки банку — всё равно на экран оплаты (отметка там)", action: "pay", mine: true, over: { bank: { mine: false, other: true } }, kind: "pay", title: n.pay.title, primary: pay },
  { name: "оплата закрыта: нет отметки мастера, своей тоже нет", action: "pay", mine: true, over: { bank: { mine: false, other: false } }, kind: "pay-wait-master", title: n.payWaitMaster.title, primary: null },
  { name: "оплата закрыта: своя отметка дана, ждём мастера", action: "pay", mine: true, over: { bank: { mine: true, other: false } }, kind: "pay-wait-master", title: n.payWaitMaster.titleMineGiven, primary: null },
  { name: "онлайн-оплата ждёт подтверждения банка", action: "waitPaymentConfirmation", mine: false, kind: "pay-pending", title: n.payPending.title, primary: null },
  { name: "ручной провайдер: переведите N ₸ по реквизитам", action: "waitPaymentConfirmation", mine: false, over: { manual: true }, kind: "pay-transfer", title: n.payTransfer.title(formatMoney(102_000_00n)), primary: null },
  { name: "ждём начала работ", action: "waitStart", mine: false, kind: "wait-start", title: n.waitStart.title, primary: null },
  { name: "ждём готовности", action: "waitReady", mine: false, kind: "wait-ready", title: n.waitReady.title, primary: null },
  { name: "принять мебель (акт)", action: "signAct", mine: true, kind: "accept", title: n.accept.title, primary: { label: n.accept.action, href: "/v2/deals/d1/sign/a1" } },
  { name: "акта нет — кнопки нет", action: "signAct", mine: true, over: { actId: null }, kind: "unknown", title: n.unknown.title, primary: null },
  { name: "ждём подпись акта мастером", action: "waitMasterActSignature", mine: false, kind: "wait-act", title: n.waitAct.title, primary: null },
  { name: "банк проводит выплату", action: "waitPayout", mine: false, kind: "wait-payout", title: n.waitPayout.title, primary: null },
  { name: "банк возвращает деньги целиком (отмена после оплаты)", action: "waitRefund", mine: false, kind: "wait-refund", title: n.waitRefund.title, primary: null },
  { name: "деньги уходят частями без решения спора в данных", action: "waitRefund", mine: false, over: { refundAll: false }, kind: "wait-settlement", title: n.waitSettlement.title, primary: null },
  { name: "открыт спор: без главной кнопки", action: "waitDispute", mine: false, kind: "dispute", title: n.dispute.title, primary: null },
  { name: "оставить отзыв", action: "leaveReview", mine: true, kind: "review", title: n.review.title, primary: { label: n.review.action, href: "/v2/deals/d1/review" } },
  { name: "сделка завершена", action: "done", mine: false, kind: "done", title: n.done.title, primary: null },
  { name: "отменена", action: "cancelled", mine: false, kind: "cancelled", title: n.cancelled.title, primary: null },
  { name: "возвращена", action: "refunded", mine: false, kind: "refunded", title: n.refunded.title, primary: null },
  // Решённый спор.
  { name: "спор решён разделом: банк делит деньги", action: "waitRefund", mine: false, over: { refundAll: false, disputeOutcome: "PARTIAL_SPLIT" }, kind: "dispute-split", title: n.disputeSplit.title, primary: null },
  { name: "спор решён разделом: деньги разделены", action: "done", mine: false, over: { disputeOutcome: "PARTIAL_SPLIT" }, kind: "dispute-split", title: n.disputeSplit.title, primary: null },
  { name: "спор решён разделом: отзыв остаётся главным действием", action: "leaveReview", mine: true, over: { disputeOutcome: "PARTIAL_SPLIT" }, kind: "dispute-split", title: n.disputeSplit.title, primary: { label: n.review.action, href: "/v2/deals/d1/review" } },
  { name: "спор решён возвратом: деньги возвращаются", action: "waitRefund", mine: false, over: { disputeOutcome: "FULL_REFUND" }, kind: "dispute-refund", title: n.disputeRefund.pending, primary: null },
  { name: "спор решён возвратом: деньги вернулись", action: "refunded", mine: false, over: { disputeOutcome: "FULL_REFUND" }, kind: "dispute-refund", title: n.disputeRefund.done, primary: null },
  { name: "спор решён «продолжить»: обычная строка", action: "waitReady", mine: false, over: { disputeOutcome: "CONTINUE" }, kind: "wait-ready", title: n.waitReady.title, primary: null },
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

  it("ручной провайдер: не «платить не нужно», а куда переводить; ссылка на PDF оферты; дальше — банк подтвердит", () => {
    const view = now("waitPaymentConfirmation", false, { manual: true });
    expect(view).toMatchObject({ body: n.payTransfer.body, next: n.payTransfer.next, link: { label: ru.app.deal.openDocument.CONTRACT, href: "/api/documents/c1/pdf", external: true } });
    expect(JSON.stringify(view)).not.toContain("не нужно");
    expect(now("waitPaymentConfirmation", false, { manual: true, contractPdf: null }).link).toBeNull();
    expect(now("waitPaymentConfirmation", false).body).toBe(n.payPending.body);
  });

  it("оплата закрыта до согласия мастера: своего согласия нет — второстепенная ссылка «Дать своё согласие заранее» на экран оплаты, не главное действие; дано — ссылки нет", () => {
    const open = now("pay", true, { bank: { mine: false, other: false } });
    expect(open.primary).toBeNull();
    expect(open.link).toEqual({ label: n.payWaitMaster.ahead, href: "/v2/deals/d1/pay" });
    expect(open.title).toBe(n.payWaitMaster.title);
    const given = now("pay", true, { bank: { mine: true, other: false } });
    expect(given.link).toBeNull();
    expect(given.primary).toBeNull();
    expect(given.title).toBe("Ваше согласие дано, ждём мастера");
    // Мастер согласие дал — это уже обычная оплата без ссылки.
    expect(now("pay", true, { bank: { mine: false, other: true } })).toMatchObject({ kind: "pay", link: null });
  });

  it("решённый спор разделом: текст по деньгам — идёт или завершено", () => {
    expect(now("waitRefund", false, { disputeOutcome: "PARTIAL_SPLIT", refundAll: false }).body).toBe(n.disputeSplit.pending);
    expect(now("done", false, { disputeOutcome: "PARTIAL_SPLIT" }).body).toBe(n.disputeSplit.done);
    expect(now("refunded", false, { disputeOutcome: "FULL_REFUND" }).body).toBe(n.disputeRefund.bodyDone);
    expect(now("waitRefund", false, { disputeOutcome: "FULL_REFUND" }).body).toBe(n.disputeRefund.body);
  });

  it("ждём готовности: ожидаемая дата, когда модуль её знает", () => {
    expect(now("waitReady", false, { plannedReadyAt: new Date("2026-12-20T10:00:00Z") }).body).toBe(n.waitReady.readyBy("20 декабря 2026"));
    expect(now("waitReady", false).body).toBe(n.waitReady.body);
  });

  it("спор: «Изложить свою позицию» — ссылкой на экран спора, только когда позиции ещё нет", () => {
    expect(now("waitDispute", false, { needsPosition: true }).link).toEqual({ label: n.dispute.position, href: "/v2/deals/d1/dispute" });
    expect(now("waitDispute", false).link).toBeNull();
  });

  it("id в адресах экранируется", () => {
    expect(nowView({ ...base, id: "a/b", next: { action: "pay", mine: true } }).primary?.href).toBe("/v2/deals/a%2Fb/pay");
  });
});

const snapshot = { priceTiyn: 100_000_00n, protectionTiyn: 2_000_00n, buyerTotalTiyn: 102_000_00n };
const estimate = { priceTiyn: 100_000_00n, extraTiyn: 2_000_00n, totalTiyn: 102_000_00n };
/** Блок денег журнала; пометка тестового платежа включена нарочно — экран её не показывает. */
const block = (view: MoneyView, bankBalanceTiyn = 0n): MoneyBlock => ({ ...view, bankBalanceTiyn, isTest: true });
const money = (b: MoneyBlock, manual = false) => moneyView({ block: b, estimate, snapshot, manual });
const reservedAt = new Date("2026-11-14T10:00:00Z");

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

  it("оплата в обработке: онлайн — «Оплата в обработке», ручной провайдер — «Ждём ваш перевод»; не прошла — своё", () => {
    expect(money(block({ kind: "awaiting", payment: "PENDING" }))).toMatchObject({ tone: "awaiting", title: t.money.pending.title, amount: 102_000_00n });
    expect(money(block({ kind: "awaiting", payment: "PENDING" }), true)).toMatchObject({ title: t.money.transfer.title, note: t.money.transfer.note, amount: 102_000_00n });
    expect(money(block({ kind: "awaiting", payment: "FAILED" }))).toMatchObject({ tone: "awaiting", title: t.money.failed.title, note: t.money.failed.note });
  });

  it("под защитой: единственный зелёный тон, сумма — зарезервированная; под блоком — только дата резерва (номер операции — в истории денег)", () => {
    const v = money(block({ kind: "protected", amountTiyn: 102_000_00n, reservedAt, operationRef: "X-1" }));
    expect(v).toMatchObject({ tone: "protected", title: "Деньги в банке под защитой", amount: 102_000_00n });
    expect(v.rows.map((r) => r.label)).toEqual(["Цена по оферте", "Защита сделки (2%)"]);
    expect(v.proof).toBe(t.money.reservedAt("14 ноября 2026"));
    expect(money(block({ kind: "protected", amountTiyn: 1n, reservedAt, operationRef: null })).proof).toBe(t.money.reservedAt("14 ноября 2026"));
  });

  it("спор: выплата приостановлена, сумма — остаток в банке", () => {
    const v = money(block({ kind: "frozen", amountTiyn: 96_000_00n, frozenAt: new Date() }, 102_000_00n));
    expect(v).toMatchObject({ tone: "frozen", title: t.money.frozen.title, amount: 102_000_00n });
  });

  it("выплата: главная сумма — сколько заплатил покупатель по журналу (не по снимку оферты)", () => {
    const done = { kind: "completed", paidToMasterTiyn: 96_000_00n, protectionTiyn: 2_000_00n, refundedTiyn: 0n, settled: true, completedAt: new Date() } as const;
    expect(money(block({ ...done, paidTiyn: 103_500_00n })).amount).toBe(103_500_00n);
    // Оплаты в журнале нет (не бывает при выплате) — запасной вариант, снимок оферты.
    expect(money(block(done)).amount).toBe(102_000_00n);
  });

  it("выплата: выплаты мастеру с гарантией на экране нет", () => {
    const pending = money(block({ kind: "completed", paidToMasterTiyn: 96_000_00n, protectionTiyn: 2_000_00n, refundedTiyn: 0n, settled: false, completedAt: null, paidTiyn: 102_000_00n }));
    expect(pending).toMatchObject({ tone: "completed", title: t.money.completed.title, amount: 102_000_00n, note: t.money.completed.pending });
    expect(pending.rows).toEqual([
      { label: "Цена по оферте", amount: 100_000_00n },
      { label: "Защита сделки (2%)", amount: 2_000_00n, explain: true },
    ]);
    expect(pending.rows.some((r) => r.amount === 96_000_00n)).toBe(false);
    expect(money(block({ kind: "completed", paidToMasterTiyn: 96_000_00n, protectionTiyn: 2_000_00n, refundedTiyn: 0n, settled: true, completedAt: new Date() })).note).toBe(
      t.money.completed.done,
    );
  });

  it("раздел по спору: «Возвращено вам» строкой, текст о части оплаты мастеру", () => {
    const split = money(block({ kind: "completed", paidToMasterTiyn: 48_000_00n, protectionTiyn: 1_000_00n, refundedTiyn: 51_000_00n, settled: true, completedAt: new Date(), paidTiyn: 102_000_00n }));
    expect(split).toMatchObject({ amount: 102_000_00n, note: t.money.completed.splitDone });
    expect(split.rows.at(-1)).toEqual({ label: t.money.refundedRow, amount: 51_000_00n });
    expect(money(block({ kind: "completed", paidToMasterTiyn: 48_000_00n, protectionTiyn: 1_000_00n, refundedTiyn: 51_000_00n, settled: false, completedAt: null })).note).toBe(
      t.money.completed.splitPending,
    );
  });

  it("возврат: сумма возврата; идёт — «Возвращается вам», завершён — «Возвращено вам»", () => {
    expect(money(block({ kind: "refunded", amountTiyn: 102_000_00n, settled: false, refundedAt: null }))).toMatchObject({ tone: "refunded", title: t.money.refunded.pending, amount: 102_000_00n });
    expect(money(block({ kind: "refunded", amountTiyn: 102_000_00n, settled: true, refundedAt: new Date() })).title).toBe("Возвращено вам");
  });

  it("пометки тестового платежа нет ни в одном тексте", () => {
    const blocks = [
      block({ kind: "awaiting", payment: "none" }),
      block({ kind: "protected", amountTiyn: 1n, reservedAt, operationRef: null }),
      block({ kind: "refunded", amountTiyn: 1n, settled: true, refundedAt: new Date() }),
    ];
    for (const b of blocks) expect(JSON.stringify(money(b), (_k, v: unknown) => (typeof v === "bigint" ? String(v) : v))).not.toMatch(/тестов/i);
  });
});

describe("cancelText: последствия отмены по факту cancelDeal", () => {
  const protectedBlock = block({ kind: "protected", amountTiyn: 102_000_00n, reservedAt, operationRef: null });
  const awaitingBlock = block({ kind: "awaiting", payment: "none" });
  it("до оплаты — денег не было", () => {
    expect(cancelText({ side: "CLIENT", canCancel: true, status: "CREATED", block: awaitingBlock, manual: false })).toBe("Сделка будет отменена. Деньги не списывались.");
  });
  it("после онлайн-оплаты — вся зарезервированная сумма вернётся на карту, включая защиту", () => {
    expect(cancelText({ side: "CLIENT", canCancel: true, status: "PAID_HOLD", block: protectedBlock, manual: false })).toBe(
      `Сделка будет отменена, ${formatMoney(102_000_00n)} вернутся на вашу карту — включая защиту сделки.`,
    );
  });
  it("после перевода по реквизитам — «вернутся вам», не «на карту»", () => {
    expect(cancelText({ side: "CLIENT", canCancel: true, status: "PAID_HOLD", block: protectedBlock, manual: true })).toBe(
      `Сделка будет отменена, ${formatMoney(102_000_00n)} вернутся вам — включая защиту сделки.`,
    );
  });
  it("отмена недоступна — пункта нет", () => {
    expect(cancelText({ side: "CLIENT", canCancel: false, status: "CREATED", block: awaitingBlock, manual: false })).toBeNull();
    expect(cancelText({ side: "CLIENT", canCancel: true, status: "IN_PROGRESS", block: protectedBlock, manual: false })).toBeNull();
  });
});

describe("заказ", () => {
  const order = { title: "Кухня", city: "Астана", plannedReadyAt: null, signedAt: null, durationDays: 30, warrantyMonths: 12, readyShownInNow: false };
  it("до оферты: что делаем, город, срок в днях, гарантия; строки мастера нет", () => {
    expect(orderRows(order).map((r) => r.label)).toEqual([t.order.what, t.order.city, t.order.duration, t.order.warranty]);
  });
  it("после оферты с плановой датой: только дата готовности (без срока в днях) и дата оферты", () => {
    const rows = orderRows({ ...order, plannedReadyAt: new Date("2026-12-20T10:00:00Z"), signedAt: new Date("2026-11-14T10:00:00Z") });
    expect(rows.map((r) => r.label)).toEqual([t.order.what, t.order.city, t.order.readyBy, t.order.warranty, t.order.signedAt]);
    expect(rows[2]?.value).toBe("20 декабря 2026");
  });
  it("дату уже назвала карточка «Сейчас» — здесь не повторяется", () => {
    const rows = orderRows({ ...order, plannedReadyAt: new Date("2026-12-20T10:00:00Z"), readyShownInNow: true });
    expect(rows.map((r) => r.label)).not.toContain(t.order.readyBy);
    expect(rows.map((r) => r.label)).not.toContain(t.order.duration);
  });
});

describe("отзыв", () => {
  it("нет отзыва — блока нет; есть — оценка «N из 5», текст (если есть), дата", () => {
    expect(reviewRows(null)).toBeNull();
    const at = new Date("2026-11-14T10:00:00Z");
    expect(reviewRows({ rating: 4, text: "Хорошо", createdAt: at })).toEqual([
      { label: t.review.rating, value: "4 из 5", stacked: false },
      { label: t.review.text, value: "Хорошо", stacked: true },
      { label: t.review.date, value: "14 ноября 2026", stacked: false },
    ]);
    expect(reviewRows({ rating: 5, text: null, createdAt: at })?.map((r) => r.label)).toEqual([t.review.rating, t.review.date]);
  });
});

describe("документы", () => {
  it("название с номером; статус по роду документа; «Ждёт вашей подписи»; выписка — без подписи", () => {
    const rows = documentRows([
      { id: "c1", kind: "CONTRACT", number: "Д-1", status: "SIGNED", pdfUrl: "/api/documents/c1/pdf", signable: true, canSign: { hand: false, ecp: false } },
      { id: "c2", kind: "CONTRACT", number: "Д-2", status: "SIGNING", pdfUrl: "/api/documents/c2/pdf", signable: true, canSign: { hand: true, ecp: false } },
      { id: "a1", kind: "ACCEPTANCE_ACT", number: "А-1", status: "SIGNED", pdfUrl: "/api/documents/a1/pdf", signable: true, canSign: { hand: false, ecp: false } },
      { id: "a2", kind: "ACCEPTANCE_ACT", number: "А-2", status: "SIGNING", pdfUrl: "/api/documents/a2/pdf", signable: true, canSign: { hand: false, ecp: false } },
      { id: "m1", kind: "MONEY_STATEMENT", number: "В-1", status: "SIGNING", pdfUrl: "/api/documents/m1/pdf", signable: false, canSign: { hand: false, ecp: false } },
    ]);
    expect(rows.map((r) => [r.name, r.status])).toEqual([
      ["Оферта № Д-1", "Подписана"],
      ["Оферта № Д-2", t.documents.yours],
      ["Акт приёмки № А-1", "Подписан"],
      ["Акт приёмки № А-2", "Ждёт подписей"],
      ["Выписка по деньгам № В-1", "Подпись не нужна"],
    ]);
    expect(rows[0]?.href).toBe("/api/documents/c1/pdf");
    expect(rows.map((r) => r.open)).toEqual(["Открыть оферту", "Открыть оферту", "Открыть акт", "Открыть акт", "Открыть выписку"]);
  });

  it.each([
    ["раздел по спору", "PARTIAL_SPLIT", "Не подписан: спор решён оператором"],
    ["полный возврат по спору", "FULL_REFUND", "Не подписан: спор решён оператором"],
    ["спор решён «продолжить» — акт ещё ждёт подписей", "CONTINUE", "Ждёт подписей"],
    ["спора не было", null, "Ждёт подписей"],
  ] as const)("неподписанный акт, %s", (_name, outcome, status) => {
    const act = { id: "a", kind: "ACCEPTANCE_ACT" as const, number: "А-1", status: "SIGNING" as const, pdfUrl: "/x", signable: true, canSign: { hand: false, ecp: false } };
    expect(documentRows([act], outcome)[0]?.status).toBe(status);
    // Подписанный акт остаётся «Подписан» при любом исходе.
    expect(documentRows([{ ...act, status: "SIGNED" }], outcome)[0]?.status).toBe("Подписан");
  });
});

/** События в порядке журнала модуля (seq), время — по порядку. */
const events = (list: [action: string, actor: string][]): HistoryEvent[] =>
  list.map(([action, actorRole], i) => ({ id: `e${i}`, action, actorRole, createdAt: new Date(Date.UTC(2026, 10, 1, 10, i)) }));
const titles = (list: [string, string][], limit = 100) => historyView(events(list), { all: false, limit }, "CLIENT").items.map((i) => i.title);

describe("historyView: события словами покупателя", () => {
  const h = t.history;
  it.each([
    ["deal.created", "SYSTEM", h.created],
    ["deal.signed", "SYSTEM", h.concluded],
    ["deal.paid", "SYSTEM", h.paid],
    ["deal.started", "EXECUTOR", h.started],
    ["deal.progress.reported", "EXECUTOR", h.progress],
    ["deal.ready", "EXECUTOR", h.ready],
    ["deal.accepted", "SYSTEM", h.accepted],
    ["deal.completed", "SYSTEM", h.completed],
    ["dispute.opened", "CLIENT", h.disputeOpened.you],
    ["dispute.opened", "EXECUTOR", h.disputeOpened.master],
    ["dispute.position.submitted", "CLIENT", h.position.you],
    ["dispute.position.submitted", "EXECUTOR", h.position.master],
    ["dispute.resolved", "OPERATOR", h.disputeResolved],
    ["deal.cancelled", "CLIENT", h.cancelled.you],
    ["deal.cancelled", "EXECUTOR", h.cancelled.master],
    ["deal.cancel.requested", "CLIENT", h.cancelRequested],
    ["deal.refunded", "SYSTEM", h.refunded],
    ["review.created", "CLIENT", h.review],
  ])("%s от %s", (action, actor, title) => {
    expect(titles([[action, actor]])).toEqual([title]);
  });

  it.each([
    "document.created",
    "document.superseded",
    "document.signing.started",
    "document.link.created",
    "document.link.opened",
    "document.signed",
    "payment.operation.succeeded",
    "payment.operation.confirmed",
    "payment.operation.retried",
    "deal.payment.requested",
    "chat.closed",
    "chat.reopened",
    "deal.stage",
    "что-то.новое",
  ])("служебное и неизвестное не показывается: %s", (action) => {
    expect(titles([[action, "SYSTEM"]])).toEqual([]);
  });

  it("подписи: одна строка на сторону и документ; до сдачи работы — оферта, после — акт; свежие сверху", () => {
    const got = titles([
      ["deal.created", "SYSTEM"],
      ["document.hand_signature.added", "CLIENT"],
      ["document.signature.added", "CLIENT"],
      ["document.hand_signature.added", "EXECUTOR"],
      ["document.signature.added", "EXECUTOR"],
      ["deal.signed", "SYSTEM"],
      ["deal.ready", "EXECUTOR"],
      ["document.hand_signature.added", "CLIENT"],
      ["document.signature.added", "CLIENT"],
      ["document.signature.added", "EXECUTOR"],
    ]);
    expect(got).toEqual([
      h.signed.master.act,
      h.signed.you.act,
      h.ready,
      h.concluded,
      h.signed.master.contract,
      h.signed.you.contract,
      h.created,
    ]);
  });

  it("свёрнута до лимита устройства; «Показать всё» — все", () => {
    const list: [string, string][] = Array.from({ length: 7 }, () => ["deal.progress.reported", "EXECUTOR"]);
    expect(historyView(events(list), { all: false, limit: HISTORY_SHOWN.mobile }, "CLIENT")).toMatchObject({ more: true });
    expect(historyView(events(list), { all: false, limit: HISTORY_SHOWN.mobile }, "CLIENT").items).toHaveLength(3);
    expect(historyView(events(list), { all: false, limit: HISTORY_SHOWN.desktop }, "CLIENT").items).toHaveLength(5);
    expect(historyView(events(list), { all: true, limit: 3 }, "CLIENT")).toMatchObject({ more: false });
    expect(historyView(events(list), { all: true, limit: 3 }, "CLIENT").items).toHaveLength(7);
  });
});

// ─── Сторона мастера ─────────────────────────────────────────────────────────────────────────────────────────────────

const m = ru.app.master.deal;
const mn = m.now;
const master = (action: NextAction, mine: boolean, over: Partial<NowInput> = {}) => nowView({ ...base, side: "EXECUTOR", next: { action, mine }, ...over });

/**
 * Таблица «что сейчас» мастера — по строке на каждое значение `next.action`, которое модуль отдаёт мастеру
 * (deal-core/next-step.ts: подписать оферту с согласием банку, ждать подпись покупателя, ждать оплату, начать работу, сдать
 * работу, подписать акт, ждать покупателя, ждать оплату от банка, спор, завершена, отменена, возвращена), плюс согласие для
 * банка после оферты, оплата у банка, возврат частями, решённый спор и шаги чужих ролей.
 */
const MASTER_TABLE: { name: string; action: NextAction; mine: boolean; over?: Partial<NowInput>; kind: NowKind; title: string; primary: { label: string; href: string } | null }[] = [
  { name: "подписать оферту (согласие для банка — на экране подписи)", action: "signContract", mine: true, kind: "sign-offer", title: mn.signOffer.title, primary: { label: mn.signOffer.action, href: "/v2/deals/d1/sign/c1" } },
  { name: "оферты нет — кнопки нет", action: "signContract", mine: true, over: { contractId: null }, kind: "unknown", title: mn.unknown.title, primary: null },
  { name: "ждём подпись оферты покупателем", action: "waitContractSignature", mine: false, kind: "wait-offer", title: mn.waitOffer.title, primary: null },
  { name: "ждём оплату покупателя", action: "waitPayment", mine: false, kind: "wait-pay", title: mn.waitPay.title, primary: null },
  { name: "ждём оплату: своё согласие для банка дано", action: "waitPayment", mine: false, over: { bank: { mine: true, other: true } }, kind: "wait-pay", title: mn.waitPay.title, primary: null },
  { name: "оферта заключена, своего согласия для банка нет — дать согласие", action: "waitPayment", mine: false, over: { bank: { mine: false, other: true } }, kind: "bank-consent", title: mn.bankConsent.title, primary: { label: mn.bankConsent.action, href: "/v2/deals/d1/sign/c1" } },
  { name: "согласия нет и оферты нет — без кнопки", action: "waitPayment", mine: false, over: { bank: { mine: false, other: false }, contractId: null }, kind: "bank-consent", title: mn.bankConsent.title, primary: null },
  { name: "оплата у банка", action: "waitPaymentConfirmation", mine: false, kind: "pay-pending", title: mn.payPending.title, primary: null },
  { name: "оплата переводом у банка — то же для мастера", action: "waitPaymentConfirmation", mine: false, over: { manual: true }, kind: "pay-pending", title: mn.payPending.title, primary: null },
  { name: "начать работу", action: "startWork", mine: true, kind: "start", title: mn.start.title, primary: { label: mn.start.action, href: "/v2/deals/d1/start" } },
  { name: "сдать работу", action: "submitReady", mine: true, kind: "ready", title: mn.ready.title, primary: { label: mn.ready.action, href: "/v2/deals/d1/ready" } },
  { name: "подписать акт ЭЦП", action: "signActEcp", mine: true, kind: "sign-act", title: mn.signAct.title, primary: { label: mn.signAct.action, href: "/v2/deals/d1/sign/a1" } },
  { name: "акта нет — кнопки нет", action: "signActEcp", mine: true, over: { actId: null }, kind: "unknown", title: mn.unknown.title, primary: null },
  { name: "ждём приёмку покупателем", action: "waitAct", mine: false, kind: "wait-act", title: mn.waitAct.title, primary: null },
  { name: "ждём оплату от банка", action: "waitPayout", mine: false, kind: "wait-payout", title: mn.waitPayout.title, primary: null },
  { name: "банк возвращает деньги покупателю", action: "waitRefund", mine: false, kind: "wait-refund", title: mn.waitRefund.title, primary: null },
  { name: "деньги уходят частями без решения спора в данных", action: "waitRefund", mine: false, over: { refundAll: false }, kind: "wait-settlement", title: mn.waitSettlement.title, primary: null },
  { name: "спор", action: "waitDispute", mine: false, kind: "dispute", title: mn.dispute.title, primary: null },
  { name: "завершена", action: "done", mine: false, kind: "done", title: mn.done.title, primary: null },
  { name: "отменена", action: "cancelled", mine: false, kind: "cancelled", title: mn.cancelled.title, primary: null },
  { name: "возвращена", action: "refunded", mine: false, kind: "refunded", title: mn.refunded.title, primary: null },
  // Решённый спор.
  { name: "спор решён разделом: банк делит деньги", action: "waitRefund", mine: false, over: { refundAll: false, disputeOutcome: "PARTIAL_SPLIT" }, kind: "dispute-split", title: mn.disputeSplit.title, primary: null },
  { name: "спор решён разделом: оплата вам проведена", action: "done", mine: false, over: { disputeOutcome: "PARTIAL_SPLIT" }, kind: "dispute-split", title: mn.disputeSplit.title, primary: null },
  { name: "спор решён возвратом покупателю: идёт", action: "waitRefund", mine: false, over: { disputeOutcome: "FULL_REFUND" }, kind: "dispute-refund", title: mn.disputeRefund.pending, primary: null },
  { name: "спор решён возвратом покупателю: вернулись", action: "refunded", mine: false, over: { disputeOutcome: "FULL_REFUND" }, kind: "dispute-refund", title: mn.disputeRefund.done, primary: null },
  { name: "спор решён «продолжить»: обычная строка", action: "submitReady", mine: true, over: { disputeOutcome: "CONTINUE" }, kind: "ready", title: mn.ready.title, primary: { label: mn.ready.action, href: "/v2/deals/d1/ready" } },
  // Шаги покупателя и оператора: мастеру модуль их не отдаёт; если вдруг — без кнопки.
  ...(["pay", "waitStart", "waitReady", "signAct", "waitMasterActSignature", "leaveReview", "resolveDispute", "none"] as const).map((action) => ({
    name: `чужой шаг ${action}`,
    action,
    mine: action === "pay" || action === "signAct" || action === "leaveReview" || action === "resolveDispute",
    kind: "unknown" as const,
    title: mn.unknown.title,
    primary: null,
  })),
];

describe("nowView: таблица «что сейчас» мастера", () => {
  it.each(MASTER_TABLE)("$name", ({ action, mine, over, kind, title, primary }) => {
    const view = master(action, mine, over);
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
    expect(new Set(MASTER_TABLE.map((r) => r.action))).toEqual(new Set(all));
  });

  it("главная кнопка — только у своего шага: чужой signContract/startWork/submitReady/signActEcp кнопки не даёт", () => {
    for (const action of ["signContract", "startWork", "submitReady", "signActEcp"] as const) expect(master(action, false)).toMatchObject({ kind: "unknown", primary: null });
  });

  it("подпись оферты: без согласия для банка — сначала согласие, с согласием — проверить условия", () => {
    expect(master("signContract", true).body).toBe(mn.signOffer.body);
    expect(master("signContract", true, { bank: { mine: false, other: false } }).body).toBe(mn.signOffer.body);
    expect(master("signContract", true, { bank: { mine: true, other: false } }).body).toBe(mn.signOffer.bodyConsentGiven);
  });

  it("сдача работы: второстепенная ссылка — отчёт о ходе работ; ожидаемая дата, когда модуль её знает", () => {
    expect(master("submitReady", true).link).toEqual({ label: mn.ready.progress, href: "/v2/deals/d1/progress" });
    expect(master("submitReady", true).body).toBe(mn.ready.body);
    expect(master("submitReady", true, { plannedReadyAt: new Date("2026-12-20T10:00:00Z") }).body).toBe(mn.ready.readyBy("20 декабря 2026"));
  });

  it("спор: «Изложить свою позицию» — ссылкой на экран спора, только когда позиции ещё нет", () => {
    expect(master("waitDispute", false, { needsPosition: true }).link).toEqual({ label: mn.dispute.position, href: "/v2/deals/d1/dispute" });
    expect(master("waitDispute", false).link).toBeNull();
  });

  it("решённый спор: текст по деньгам — идёт или завершено", () => {
    expect(master("waitPayout", false, { disputeOutcome: "PARTIAL_SPLIT" }).body).toBe(mn.disputeSplit.pending);
    expect(master("done", false, { disputeOutcome: "PARTIAL_SPLIT" }).body).toBe(mn.disputeSplit.done);
    expect(master("refunded", false, { disputeOutcome: "FULL_REFUND" }).body).toBe(mn.disputeRefund.bodyDone);
  });

  it("сумм покупателя нет: ни «к оплате», ни защиты сделки — в любой строке", () => {
    for (const row of MASTER_TABLE) {
      const text = JSON.stringify(master(row.action, row.mine, { ...row.over, manual: true }));
      expect(text).not.toContain(formatMoney(102_000_00n));
      expect(text).not.toMatch(/защит[аы] сделки|2\s?%/i);
    }
  });

  it("строки покупателя не меняются от строк мастера: та же сделка глазами покупателя — его таблица", () => {
    expect(nowView({ ...base, next: { action: "signContract", mine: true } }).title).toBe(n.signOffer.title);
    expect(nowView({ ...base, next: { action: "startWork", mine: true } }).kind).toBe("unknown");
    expect(master("pay", true).kind).toBe("unknown");
  });

  it("id в адресах экранируется", () => {
    expect(nowView({ ...base, id: "a/b", side: "EXECUTOR", next: { action: "startWork", mine: true } }).primary?.href).toBe("/v2/deals/a%2Fb/start");
  });
});

describe("cancelText мастера: только до оплаты", () => {
  const awaitingBlock = block({ kind: "awaiting", payment: "none" });
  const protectedBlock = block({ kind: "protected", amountTiyn: 102_000_00n, reservedAt, operationRef: null });
  it("до оплаты — покупатель ещё не платил", () => {
    expect(cancelText({ side: "EXECUTOR", canCancel: true, status: "CREATED", block: awaitingBlock, manual: false })).toBe(m.actions.cancelBeforePay);
  });
  it("после оплаты мастер не отменяет — текста нет (и суммы покупателя тоже)", () => {
    expect(cancelText({ side: "EXECUTOR", canCancel: true, status: "PAID_HOLD", block: protectedBlock, manual: false })).toBeNull();
    expect(cancelText({ side: "EXECUTOR", canCancel: false, status: "CREATED", block: awaitingBlock, manual: false })).toBeNull();
  });
});

describe("historyView: события словами мастера («Вы» — мастер)", () => {
  const h = m.history;
  const masterTitles = (list: [string, string][]) => historyView(events(list), { all: true, limit: 100 }, "EXECUTOR").items.map((i) => i.title);
  it.each([
    ["deal.created", "SYSTEM", h.created],
    ["deal.signed", "SYSTEM", h.concluded],
    ["deal.paid", "SYSTEM", h.paid],
    ["deal.started", "EXECUTOR", h.started],
    ["deal.progress.reported", "EXECUTOR", h.progress],
    ["deal.ready", "EXECUTOR", h.ready],
    ["deal.accepted", "SYSTEM", h.accepted],
    ["deal.completed", "SYSTEM", h.completed],
    ["dispute.opened", "EXECUTOR", h.disputeOpened.you],
    ["dispute.opened", "CLIENT", h.disputeOpened.other],
    ["dispute.opened", "OPERATOR", h.disputeOpened.unknown],
    ["dispute.position.submitted", "EXECUTOR", h.position.you],
    ["dispute.position.submitted", "CLIENT", h.position.other],
    ["dispute.resolved", "OPERATOR", h.disputeResolved],
    ["deal.cancelled", "EXECUTOR", h.cancelled.you],
    ["deal.cancelled", "CLIENT", h.cancelled.other],
    ["deal.cancelled", "SYSTEM", h.cancelled.unknown],
    ["deal.cancel.requested", "CLIENT", h.cancelRequested],
    ["deal.refunded", "SYSTEM", h.refunded],
    ["review.created", "CLIENT", h.review],
  ])("%s от %s", (action, actor, title) => {
    expect(masterTitles([[action, actor]])).toEqual([title]);
  });

  it("подписи: «Вы» — мастер, другая сторона — «Покупатель»; одна строка на сторону и документ", () => {
    expect(
      masterTitles([
        ["document.hand_signature.added", "CLIENT"],
        ["document.signature.added", "CLIENT"],
        ["document.hand_signature.added", "EXECUTOR"],
        ["document.signature.added", "EXECUTOR"],
        ["deal.ready", "EXECUTOR"],
        ["document.signature.added", "EXECUTOR"],
        ["document.signature.added", "CLIENT"],
      ]),
    ).toEqual([h.signed.other.act, h.signed.you.act, h.ready, h.signed.you.contract, h.signed.other.contract]);
  });

  it("та же история глазами покупателя — его слова («Вы» — покупатель, «Мастер …»)", () => {
    const list: [string, string][] = [
      ["dispute.opened", "EXECUTOR"],
      ["deal.cancelled", "CLIENT"],
    ];
    expect(historyView(events(list), { all: true, limit: 100 }, "CLIENT").items.map((i) => i.title)).toEqual([t.history.cancelled.you, t.history.disputeOpened.master]);
    expect(masterTitles(list)).toEqual([h.cancelled.other, h.disputeOpened.you]);
  });
});

describe("masterMoneyView: блок денег мастера из журнала — без сумм покупателя", () => {
  const md = ru.app.masterDeal.card.money;
  // Смета мастера модуля (`partyEstimate("EXECUTOR")`): цена 100 000 ₸, гарантия 4% — 4 000 ₸, «вы получите» — 96 000 ₸.
  const mine = { priceTiyn: 100_000_00n, extraTiyn: 4_000_00n, totalTiyn: 96_000_00n };
  const master = (b: MoneyBlock) => masterMoneyView({ block: b, estimate: mine });
  const offerRows = (youGet: bigint) => [
    { label: md.price, amount: 100_000_00n },
    { label: md.guarantee, amount: 4_000_00n, explain: true },
    { label: md.youGet, amount: youGet, total: true },
  ];
  /** Суммы покупателя в журнале: оплата с защитой (102 000 ₸) и остаток в банке. Мастеру их видно быть не должно. */
  const BUYER_SUMS = [102_000_00n, 2_000_00n];
  const amounts = (v: ReturnType<typeof master>) => [v.amount, ...v.rows.map((r) => r.amount)];

  const CASES: { name: string; block: MoneyBlock; tone: string; title: string; amount: bigint }[] = [
    { name: "ждём оплату покупателя", block: block({ kind: "awaiting", payment: "none" }), tone: "awaiting", title: md.awaiting.title, amount: 96_000_00n },
    { name: "оплата обрабатывается", block: block({ kind: "awaiting", payment: "PENDING" }), tone: "awaiting", title: md.pending.title, amount: 96_000_00n },
    { name: "оплата покупателя не прошла", block: block({ kind: "awaiting", payment: "FAILED" }), tone: "awaiting", title: md.failed.title, amount: 96_000_00n },
    {
      name: "деньги покупателя в банке под защитой",
      block: block({ kind: "protected", amountTiyn: 102_000_00n, reservedAt, operationRef: "B-1" }, 102_000_00n),
      tone: "protected",
      title: md.protected.title,
      amount: 96_000_00n,
    },
    {
      name: "оплата приостановлена спором",
      block: block({ kind: "frozen", amountTiyn: 102_000_00n, frozenAt: reservedAt }, 102_000_00n),
      tone: "frozen",
      title: md.frozen.title,
      amount: 96_000_00n,
    },
    {
      name: "банк переводит оплату",
      block: block({ kind: "completed", paidToMasterTiyn: 96_000_00n, protectionTiyn: 2_000_00n, refundedTiyn: 0n, settled: false, completedAt: null, paidTiyn: 102_000_00n }),
      tone: "completed",
      title: md.completed.pending,
      amount: 96_000_00n,
    },
    {
      name: "оплата получена",
      block: block({ kind: "completed", paidToMasterTiyn: 96_000_00n, protectionTiyn: 2_000_00n, refundedTiyn: 0n, settled: true, completedAt: reservedAt, paidTiyn: 102_000_00n }),
      tone: "completed",
      title: md.completed.done,
      amount: 96_000_00n,
    },
  ];

  it.each(CASES)("$name: тон, заголовок, «вы получите»; строки — цена, гарантия 4%, «Вы получите»", ({ block: b, tone, title, amount }) => {
    const v = master(b);
    expect(v).toMatchObject({ tone, title, amount });
    expect(v.rows).toEqual(offerRows(amount));
    for (const sum of BUYER_SUMS) expect(amounts(v)).not.toContain(sum);
  });

  it("только «под защитой» — зелёный блок с датой резерва из журнала", () => {
    const tones = CASES.map((c) => master(c.block).tone);
    expect(tones.filter((x) => x === "protected")).toHaveLength(1);
    const held = master(block({ kind: "protected", amountTiyn: 102_000_00n, reservedAt, operationRef: "B-1" }, 102_000_00n));
    expect(held.proof).toBe(md.reservedAt("14 ноября 2026"));
  });

  it("раздел по спору: главная сумма — часть мастера из журнала, строк сметы нет, кроме цены; остаток — словами", () => {
    const pending = master(block({ kind: "completed", paidToMasterTiyn: 31_999_99n, protectionTiyn: 666_67n, refundedTiyn: 68_000_01n, settled: false, completedAt: null }));
    expect(pending).toMatchObject({ tone: "completed", title: md.completed.splitPending, amount: 31_999_99n, note: md.completed.splitNotePending });
    expect(pending.rows).toEqual([{ label: md.price, amount: 100_000_00n }]);
    expect(amounts(pending)).not.toContain(68_000_01n);
    const done = master(block({ kind: "completed", paidToMasterTiyn: 31_999_99n, protectionTiyn: 666_67n, refundedTiyn: 68_000_01n, settled: true, completedAt: reservedAt }));
    expect(done).toMatchObject({ title: md.completed.splitDone, note: md.completed.splitNote });
  });

  it("возврат покупателю: оплаты мастеру нет (ноль), сумма возврата покупателя не показывается", () => {
    const pending = master(block({ kind: "refunded", amountTiyn: 102_000_00n, settled: false, refundedAt: null }));
    expect(pending).toMatchObject({ tone: "refunded", title: md.refunded.title, amount: 0n, note: md.refunded.pending });
    expect(amounts(pending)).not.toContain(102_000_00n);
    expect(master(block({ kind: "refunded", amountTiyn: 102_000_00n, settled: true, refundedAt: reservedAt })).note).toBe(md.refunded.done);
  });
});

describe("заказ мастера и ход работ", () => {
  const order = { title: "Кухня", city: "Астана", plannedReadyAt: null, signedAt: null, durationDays: 30, warrantyMonths: 12, readyShownInNow: false };
  it("адрес — строкой после города, только если передан", () => {
    expect(orderRows({ ...order, address: "ул. Абая, 12" }).map((r) => r.label)).toEqual([
      t.order.what,
      t.order.city,
      ru.app.masterDeal.card.order.address,
      t.order.duration,
      t.order.warranty,
    ]);
    expect(orderRows({ ...order, address: null }).map((r) => r.label)).not.toContain(ru.app.masterDeal.card.order.address);
  });

  it("отчёты: свежие сверху, без названия — «Отчёт о ходе работ», подписи фото с номером", () => {
    const r = ru.app.masterDeal.card.reports;
    const items = reportsView([
      { id: "r1", title: "  ", text: "Начали", createdAt: new Date("2026-11-10T10:00:00Z"), photos: [{ id: "p1", src: "/f/1" }, { id: "p2", src: "/f/2" }] },
      { id: "r2", title: "Корпус", text: "", createdAt: new Date("2026-11-12T10:00:00Z"), photos: [] },
    ]);
    expect(items.map((i) => i.id)).toEqual(["r2", "r1"]);
    expect(items[1]?.title).toBe(r.untitled);
    expect(items[1]?.photos.map((p) => p.alt)).toEqual([r.photoAlt(r.untitled, 1), r.photoAlt(r.untitled, 2)]);
  });
});
