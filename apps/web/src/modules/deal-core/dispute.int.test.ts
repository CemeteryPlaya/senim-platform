import { describe, expect, it } from "vitest";
import { dealAt, dealOf, journalOf, makeDeal, makePhoto, PRICE, signAct, signContract } from "../../../test/factories/deal";
import { makeOperator } from "../../../test/factories";
import { computeDealMoney, computeSplit, moneyView } from "@/modules/payments";
import { db } from "@/platform/db";
import { openDispute, resolveDispute, startWork, submitDisputePosition, submitReady } from "./index";

const money = computeDealMoney(PRICE);
const open = (user: Parameters<typeof openDispute>[0], dealId: string) => openDispute(user, { dealId, reason: "QUALITY", description: "Фасады не совпадают с договором" });
const sum = (journal: { type: string; amountTiyn: bigint; status: string }[], type: string) =>
  journal.filter((t) => t.type === type && t.status === "SUCCEEDED").reduce((a, t) => a + t.amountTiyn, 0n);

describe("открытие спора", () => {
  it("любая сторона с PAID_HOLD по READY: FREEZE суммы к выплате, блок денег жёлтый, уведомления", async () => {
    const f = await dealAt("IN_PROGRESS");
    const operator = await makeOperator();
    const { disputeId } = await openDispute(f.executor, { dealId: f.dealId, reason: "PAYMENT", description: "Покупатель не пускает на объект", photoIds: [await makePhoto(f.executor, "DISPUTE")] });
    expect(await db.dispute.findUniqueOrThrow({ where: { id: disputeId } })).toMatchObject({ status: "OPEN", openedInStatus: "IN_PROGRESS", openedById: f.executor.id });
    expect((await journalOf(f.dealId)).at(-1)).toMatchObject({ type: "FREEZE", status: "SUCCEEDED", amountTiyn: money.payoutTiyn, idempotencyKey: `freeze:${disputeId}` });
    expect(await moneyView(f.dealId)).toMatchObject({ kind: "frozen", amountTiyn: money.payoutTiyn });
    expect(await db.storedFile.count({ where: { disputeId } })).toBe(1);
    expect(await db.notification.count({ where: { userId: f.client.id, kind: "dispute.opened" } })).toBe(1);
    expect(await db.notification.count({ where: { userId: operator.id, kind: "dispute.opened" } })).toBe(1);
  });

  it("пока спор открыт — переходы запрещены; второй спор — CONFLICT (и параллельно)", async () => {
    const f = await dealAt("PAID_HOLD");
    const results = await Promise.allSettled([open(f.client, f.dealId), open(f.executor, f.dealId)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await expect(open(f.client, f.dealId)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(startWork(f.executor, { dealId: f.dealId })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.dispute.count({ where: { dealId: f.dealId } })).toBe(1);
  });

  it("до оплаты и после подписания акта — нельзя; оператор и чужой — нельзя", async () => {
    const f = await makeDeal();
    await signContract(f.dealId);
    await expect(open(f.client, f.dealId)).rejects.toMatchObject({ code: "CONFLICT" });
    const done = await dealAt("READY");
    await signAct(done.dealId);
    await expect(open(done.client, done.dealId)).rejects.toMatchObject({ code: "CONFLICT" });
    const ready = await dealAt("READY");
    await expect(open(await makeOperator(), ready.dealId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(open(f.client, ready.dealId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("позиции сторон — без контактов; после решения — нельзя", async () => {
    const f = await dealAt("READY");
    const { disputeId } = await open(f.client, f.dealId);
    await submitDisputePosition(f.client, { disputeId, position: "Звоните +7 701 123 45 67, всё покажу" });
    expect((await db.dispute.findUniqueOrThrow({ where: { id: disputeId } })).clientPosition).not.toContain("123 45 67");
    await resolveDispute(await makeOperator(), { disputeId, outcome: "CONTINUE", rationale: "Работа соответствует договору" });
    await expect(submitDisputePosition(f.executor, { disputeId, position: "Моя позиция по спору" })).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe.each(["PAID_HOLD", "READY"] as const)("решение спора на %s (ADR-009 раздел 3)", (step) => {
  it("CONTINUE: UNFREEZE, статус прежний, сделка идёт дальше", async () => {
    const f = await dealAt(step);
    const { disputeId } = await open(f.client, f.dealId);
    await resolveDispute(await makeOperator(), { disputeId, outcome: "CONTINUE", rationale: "Претензия не подтвердилась" });
    expect(await dealOf(f.dealId)).toMatchObject({ status: step });
    expect((await journalOf(f.dealId)).map((t) => t.type)).toEqual(["HOLD", "FREEZE", "UNFREEZE"]);
    expect(await moneyView(f.dealId)).toMatchObject({ kind: "protected" });
    if (step === "PAID_HOLD") await startWork(f.executor, { dealId: f.dealId });
    else await signAct(f.dealId);
    expect((await dealOf(f.dealId)).status).not.toBe(step);
  });

  it("FULL_REFUND: возврат всего оплаченного (и защиты), REFUNDED, доход платформы 0", async () => {
    const f = await dealAt(step);
    const { disputeId } = await open(f.executor, f.dealId);
    await resolveDispute(await makeOperator(), { disputeId, outcome: "FULL_REFUND", rationale: "Работы не выполнены" });
    expect(await dealOf(f.dealId)).toMatchObject({ status: "REFUNDED" });
    const journal = await journalOf(f.dealId);
    expect(journal.map((t) => t.type)).toEqual(["HOLD", "FREEZE", "UNFREEZE", "REFUND"]);
    expect(sum(journal, "REFUND")).toBe(money.buyerTotalTiyn);
    expect(sum(journal, "SPLIT_PLATFORM")).toBe(0n);
    expect(await moneyView(f.dealId)).toMatchObject({ kind: "refunded", bankBalanceTiyn: 0n });
  });

  it("PARTIAL_SPLIT: мастеру ⌊Y×0,96⌋, платформе ⌈Y×0,02⌉ + гарантия, остаток — покупателю; журнал сходится до тиына", async () => {
    const f = await dealAt(step);
    const { disputeId } = await open(f.client, f.dealId);
    const share = 33_333_33n;
    await resolveDispute(await makeOperator(), { disputeId, outcome: "PARTIAL_SPLIT", masterShareTiyn: share.toString(), rationale: "Сделана треть работ" });
    expect(await dealOf(f.dealId)).toMatchObject({ status: "SPLIT_PAYOUT" });
    const split = computeSplit(PRICE, share);
    const journal = await journalOf(f.dealId);
    expect(sum(journal, "SPLIT_MASTER")).toBe(split.masterTiyn);
    expect(sum(journal, "SPLIT_PLATFORM")).toBe(split.platformTiyn);
    expect(sum(journal, "REFUND")).toBe(split.refundTiyn);
    expect(sum(journal, "HOLD")).toBe(sum(journal, "SPLIT_MASTER") + sum(journal, "SPLIT_PLATFORM") + sum(journal, "REFUND"));
    expect(await moneyView(f.dealId)).toMatchObject({ kind: "completed", paidToMasterTiyn: split.masterTiyn, refundedTiyn: split.refundTiyn, protectionTiyn: computeDealMoney(share).protectionTiyn, bankBalanceTiyn: 0n });
    // Раздел по спору — не завершённый заказ: грейд не растёт.
    expect(await db.grade.findUnique({ where: { executorId: f.executor.executor.id } })).toBeNull();
  });
});

describe("решение спора — проверки", () => {
  it("доля мастера: обязательна только для PARTIAL_SPLIT, 0 < Y ≤ X; не оператор — FORBIDDEN; двойное решение — CONFLICT", async () => {
    const f = await dealAt("IN_PROGRESS");
    const { disputeId } = await open(f.client, f.dealId);
    const operator = await makeOperator();
    const rationale = "Обоснование решения оператора";
    await expect(resolveDispute(operator, { disputeId, outcome: "PARTIAL_SPLIT", rationale })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(resolveDispute(operator, { disputeId, outcome: "CONTINUE", masterShareTiyn: 1n, rationale })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(resolveDispute(operator, { disputeId, outcome: "PARTIAL_SPLIT", masterShareTiyn: 0n, rationale })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(resolveDispute(operator, { disputeId, outcome: "PARTIAL_SPLIT", masterShareTiyn: PRICE + 1n, rationale })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(resolveDispute(f.client, { disputeId, outcome: "CONTINUE", rationale })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const results = await Promise.allSettled([
      resolveDispute(operator, { disputeId, outcome: "FULL_REFUND", rationale }),
      resolveDispute(operator, { disputeId, outcome: "FULL_REFUND", rationale }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.moneyTransaction.count({ where: { dealId: f.dealId, type: "REFUND" } })).toBe(1);
  });

  it("Y = X — вся цена мастеру: возврата нет, доход платформы как при обычной выплате", async () => {
    const f = await dealAt("IN_PROGRESS");
    const { disputeId } = await open(f.client, f.dealId);
    await resolveDispute(await makeOperator(), { disputeId, outcome: "PARTIAL_SPLIT", masterShareTiyn: PRICE, rationale: "Работа выполнена полностью" });
    const journal = await journalOf(f.dealId);
    expect(journal.some((t) => t.type === "REFUND")).toBe(false);
    expect(sum(journal, "SPLIT_PLATFORM")).toBe(money.platformIncomeTiyn);
  });

  it("после CONTINUE на IN_PROGRESS мастер сдаёт работу", async () => {
    const f = await dealAt("IN_PROGRESS");
    const { disputeId } = await open(f.client, f.dealId);
    await resolveDispute(await makeOperator(), { disputeId, outcome: "CONTINUE", rationale: "Продолжить работу по договору" });
    await submitReady(f.executor, { dealId: f.dealId, photoIds: [await makePhoto(f.executor)] });
    expect(await dealOf(f.dealId)).toMatchObject({ status: "READY" });
  });
});
