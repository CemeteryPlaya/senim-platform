import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { formatMoney } from "@/kit";
import type { NextAction } from "@/modules/deal-core";
import type { MoneyBlock, MoneyView } from "@/modules/payments";
import { cancelText, documentRows, HISTORY_SHOWN, historyView, moneyView, nowView, orderRows, reviewRows, type HistoryEvent, type NowInput, type NowKind } from "./deal-card";

const t = ru.app.deal.card;
const n = t.now;

const base: NowInput = {
  id: "d1",
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
    expect(view).toMatchObject({ body: n.payTransfer.body, next: n.payTransfer.next, link: { label: n.payTransfer.offer, href: "/api/documents/c1/pdf", external: true } });
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

  it("под защитой: единственный зелёный тон, сумма — зарезервированная; доказательства — дата резерва и номер операции", () => {
    const v = money(block({ kind: "protected", amountTiyn: 102_000_00n, reservedAt, operationRef: "X-1" }));
    expect(v).toMatchObject({ tone: "protected", title: "Деньги в банке под защитой", amount: 102_000_00n });
    expect(v.rows.map((r) => r.label)).toEqual(["Цена по оферте", "Защита сделки (2%)"]);
    expect(v.proof).toBe(`${t.money.reservedAt("14 ноября 2026")} · ${t.money.operationRef("X-1")}`);
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

  it("возврат: сумма возврата; идёт и завершён — «вам»", () => {
    expect(money(block({ kind: "refunded", amountTiyn: 102_000_00n, settled: false, refundedAt: null }))).toMatchObject({ tone: "refunded", title: t.money.refunded.pending, amount: 102_000_00n });
    expect(money(block({ kind: "refunded", amountTiyn: 102_000_00n, settled: true, refundedAt: new Date() })).title).toBe("Деньги вернулись вам");
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
    expect(cancelText({ canCancel: true, status: "CREATED", block: awaitingBlock, manual: false })).toBe("Сделка будет отменена. Деньги не списывались.");
  });
  it("после онлайн-оплаты — вся зарезервированная сумма вернётся на карту, включая защиту", () => {
    expect(cancelText({ canCancel: true, status: "PAID_HOLD", block: protectedBlock, manual: false })).toBe(
      `Сделка будет отменена, ${formatMoney(102_000_00n)} вернутся на вашу карту — включая защиту сделки.`,
    );
  });
  it("после перевода по реквизитам — «вернутся вам», не «на карту»", () => {
    expect(cancelText({ canCancel: true, status: "PAID_HOLD", block: protectedBlock, manual: true })).toBe(
      `Сделка будет отменена, ${formatMoney(102_000_00n)} вернутся вам — включая защиту сделки.`,
    );
  });
  it("отмена недоступна — пункта нет", () => {
    expect(cancelText({ canCancel: false, status: "CREATED", block: awaitingBlock, manual: false })).toBeNull();
    expect(cancelText({ canCancel: true, status: "IN_PROGRESS", block: protectedBlock, manual: false })).toBeNull();
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
  });
});

/** События в порядке журнала модуля (seq), время — по порядку. */
const events = (list: [action: string, actor: string][]): HistoryEvent[] =>
  list.map(([action, actorRole], i) => ({ id: `e${i}`, action, actorRole, createdAt: new Date(Date.UTC(2026, 10, 1, 10, i)) }));
const titles = (list: [string, string][], limit = 100) => historyView(events(list), { all: false, limit }).items.map((i) => i.title);

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
    expect(historyView(events(list), { all: false, limit: HISTORY_SHOWN.mobile })).toMatchObject({ more: true });
    expect(historyView(events(list), { all: false, limit: HISTORY_SHOWN.mobile }).items).toHaveLength(3);
    expect(historyView(events(list), { all: false, limit: HISTORY_SHOWN.desktop }).items).toHaveLength(5);
    expect(historyView(events(list), { all: true, limit: 3 })).toMatchObject({ more: false });
    expect(historyView(events(list), { all: true, limit: 3 }).items).toHaveLength(7);
  });
});
