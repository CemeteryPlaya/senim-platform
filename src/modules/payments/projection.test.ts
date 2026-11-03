import { describe, expect, it } from "vitest";
import type { MoneyTransactionStatus, MoneyTransactionType } from "@/generated/prisma/enums";
import { computeDealMoney, computeSplit } from "./money";
import { moneyFacts, moneyHistoryOf, projectMoney, retryCheck, type LedgerEntry } from "./projection";

const X = 100_000_00n; // 100 000 ₸
const money = computeDealMoney(X);
let seq = 0n;

function entry(type: MoneyTransactionType, amountTiyn: bigint, status: MoneyTransactionStatus = "SUCCEEDED", extra: Partial<LedgerEntry> = {}): LedgerEntry {
  seq += 1n;
  const createdAt = new Date(Date.UTC(2026, 10, 1, 0, Number(seq), 0));
  return {
    id: `t${seq}`,
    seq,
    type,
    status,
    amountTiyn,
    isTest: false,
    parentId: null,
    disputeId: null,
    externalRef: `ref-${seq}`,
    basisDocumentId: null,
    createdAt,
    // Итог приходит позже записи: блок и история показывают время итога.
    settledAt: status === "PENDING" ? null : new Date(createdAt.getTime() + 30_000),
    disputeShareTiyn: null,
    ...extra,
  };
}

function payout(status: MoneyTransactionStatus = "SUCCEEDED", share?: bigint) {
  const split = share === undefined ? { masterTiyn: money.payoutTiyn, platformTiyn: money.platformIncomeTiyn } : computeSplit(X, share);
  const release = entry("RELEASE", split.masterTiyn + split.platformTiyn, "SUCCEEDED", { basisDocumentId: "act-1", disputeShareTiyn: share ?? null });
  return [
    release,
    entry("SPLIT_MASTER", split.masterTiyn, status, { parentId: release.id }),
    entry("SPLIT_PLATFORM", split.platformTiyn, status, { parentId: release.id }),
  ];
}

const view = (entries: LedgerEntry[]) => projectMoney(entries, { priceTiyn: X });

describe("блок денег — только из журнала", () => {
  it("нет операций — ожидает оплаты", () => {
    expect(view([])).toMatchObject({ kind: "awaiting", payment: "none", bankBalanceTiyn: 0n });
  });

  it("оплата в банке и отклонённая оплата — всё ещё ожидает", () => {
    expect(view([entry("HOLD", money.buyerTotalTiyn, "PENDING")])).toMatchObject({ kind: "awaiting", payment: "PENDING" });
    expect(view([entry("HOLD", money.buyerTotalTiyn, "FAILED")])).toMatchObject({ kind: "awaiting", payment: "FAILED", bankBalanceTiyn: 0n });
  });

  it("HOLD подтверждён — под защитой банка: сумма, дата и номер операции", () => {
    const hold = entry("HOLD", money.buyerTotalTiyn);
    expect(view([hold])).toEqual({
      kind: "protected",
      amountTiyn: money.buyerTotalTiyn,
      reservedAt: hold.settledAt,
      operationRef: hold.externalRef,
      bankBalanceTiyn: money.buyerTotalTiyn,
      isTest: false,
    });
  });

  it("повторная попытка после отказа банка — под защитой по второй попытке", () => {
    const second = entry("HOLD", money.buyerTotalTiyn);
    expect(view([entry("HOLD", money.buyerTotalTiyn, "FAILED"), second])).toMatchObject({ kind: "protected", operationRef: second.externalRef });
  });

  it("спор — выплата заморожена; решение снимает заморозку", () => {
    const hold = entry("HOLD", money.buyerTotalTiyn);
    const freeze = entry("FREEZE", money.payoutTiyn, "SUCCEEDED", { disputeId: "d1" });
    expect(view([hold, freeze])).toMatchObject({ kind: "frozen", amountTiyn: money.payoutTiyn, bankBalanceTiyn: money.buyerTotalTiyn });
    expect(view([hold, freeze, entry("UNFREEZE", money.payoutTiyn, "SUCCEEDED", { disputeId: "d1" })])).toMatchObject({ kind: "protected" });
  });

  it("выплата подтверждена — сделка завершена, в банке ноль", () => {
    const block = view([entry("HOLD", money.buyerTotalTiyn), ...payout()]);
    expect(block).toMatchObject({
      kind: "completed",
      paidToMasterTiyn: money.payoutTiyn,
      protectionTiyn: money.protectionTiyn,
      refundedTiyn: 0n,
      settled: true,
      bankBalanceTiyn: 0n,
    });
    expect(block.kind === "completed" && block.completedAt).toBeInstanceOf(Date);
  });

  it("выплата в банке — завершается, но ещё не подтверждена", () => {
    expect(view([entry("HOLD", money.buyerTotalTiyn), ...payout("PENDING")])).toMatchObject({
      kind: "completed",
      settled: false,
      completedAt: null,
      bankBalanceTiyn: money.buyerTotalTiyn,
    });
  });

  it("возврат — запрошен и подтверждён", () => {
    const hold = entry("HOLD", money.buyerTotalTiyn);
    expect(view([hold, entry("REFUND", money.buyerTotalTiyn, "PENDING")])).toMatchObject({ kind: "refunded", settled: false, refundedAt: null });
    expect(view([hold, entry("REFUND", money.buyerTotalTiyn)])).toMatchObject({ kind: "refunded", settled: true, bankBalanceTiyn: 0n });
  });

  it("раздел по спору — выплата, защита от доли мастера и возврат остатка; журнал сходится до тиына", () => {
    const share = 40_000_00n;
    const split = computeSplit(X, share);
    const entries = [entry("HOLD", money.buyerTotalTiyn), ...payout("SUCCEEDED", share), entry("REFUND", split.refundTiyn)];
    expect(view(entries)).toMatchObject({
      kind: "completed",
      paidToMasterTiyn: split.masterTiyn,
      protectionTiyn: computeDealMoney(share).protectionTiyn,
      refundedTiyn: split.refundTiyn,
      settled: true,
      bankBalanceTiyn: 0n,
    });
  });

  it("тестовые операции помечены", () => {
    expect(view([entry("HOLD", money.buyerTotalTiyn, "SUCCEEDED", { isTest: true })]).isTest).toBe(true);
  });
});

describe("факты для переходов сделки", () => {
  it("выплата не завершена, пока ждёт возврат остатка", () => {
    const facts = moneyFacts([entry("HOLD", money.buyerTotalTiyn), ...payout(), entry("REFUND", 1n, "PENDING")]);
    expect(facts.payoutSettled).toBe(false);
    expect(facts.exitRequested).toBe(true);
  });

  it("отклонённая часть выплаты — выплата не завершена", () => {
    const [release, master] = payout();
    const facts = moneyFacts([entry("HOLD", money.buyerTotalTiyn), release, master, entry("SPLIT_PLATFORM", 1n, "FAILED", { parentId: release.id })]);
    expect(facts.payoutSettled).toBe(false);
  });

  it("возврат подтверждён без выплаты — refundSettled", () => {
    const facts = moneyFacts([entry("HOLD", money.buyerTotalTiyn), entry("REFUND", money.buyerTotalTiyn)]);
    expect(facts).toMatchObject({ refundSettled: true, payoutSettled: false, exitRequested: true, refundedTiyn: money.buyerTotalTiyn });
  });

  it("порядок записей на входе не важен — важен seq", () => {
    const entries = [entry("HOLD", money.buyerTotalTiyn, "FAILED"), entry("HOLD", money.buyerTotalTiyn)];
    expect(moneyFacts([...entries].reverse()).hold).toBe("SUCCEEDED");
  });
});

describe("факты: что считается запрошенным и завершённым", () => {
  it("заморозка без выплаты и возврата — деньги не уходят; выплата или возврат (любой статус) — уходят", () => {
    const hold = entry("HOLD", money.buyerTotalTiyn);
    expect(moneyFacts([hold, entry("FREEZE", 1n, "SUCCEEDED", { disputeId: "d" })]).exitRequested).toBe(false);
    expect(moneyFacts([hold, entry("RELEASE", 1n, "PENDING")]).exitRequested).toBe(true);
    expect(moneyFacts([hold, entry("REFUND", 1n, "FAILED")]).exitRequested).toBe(true);
  });

  it("отклонённые раскрытие и возврат не считаются запрошенными: блок — снова под защитой", () => {
    const hold = entry("HOLD", money.buyerTotalTiyn);
    const facts = moneyFacts([hold, entry("REFUND", money.buyerTotalTiyn, "FAILED"), entry("RELEASE", 1n, "FAILED")]);
    expect(facts).toMatchObject({ refundEntry: null, releaseEntry: null, refundSettled: false, payoutSettled: false });
    expect(view([hold, entry("REFUND", money.buyerTotalTiyn, "FAILED")])).toMatchObject({ kind: "protected" });
  });

  it("раскрытие без частей — выплата не завершена; отказ прежней оплаты не мешает завершению", () => {
    const failedHold = entry("HOLD", money.buyerTotalTiyn, "FAILED");
    expect(moneyFacts([entry("HOLD", money.buyerTotalTiyn), entry("RELEASE", 1n)]).payoutSettled).toBe(false);
    expect(moneyFacts([failedHold, entry("HOLD", money.buyerTotalTiyn), ...payout()]).payoutSettled).toBe(true);
  });

  it("возврат при разделе по спору — не «возврат целиком»; ждущий возврат — тоже", () => {
    const hold = entry("HOLD", money.buyerTotalTiyn);
    expect(moneyFacts([hold, ...payout(), entry("REFUND", 1n)]).refundSettled).toBe(false);
    expect(moneyFacts([hold, entry("REFUND", money.buyerTotalTiyn, "PENDING")]).refundSettled).toBe(false);
  });

  it("тестовая хотя бы одна операция — блок помечен", () => {
    expect(view([entry("HOLD", 1n, "FAILED", { isTest: true }), entry("HOLD", money.buyerTotalTiyn)]).isTest).toBe(true);
  });

  it("время завершения — последний итог среди раскрытия, частей и возврата", () => {
    const hold = entry("HOLD", money.buyerTotalTiyn);
    const parts = payout();
    const refund = entry("REFUND", 1n);
    const block = view([hold, ...parts, refund]);
    expect(block.kind === "completed" && block.completedAt).toEqual(refund.settledAt);
    const noRefund = view([hold, ...parts]);
    expect(noRefund.kind === "completed" && noRefund.completedAt).toEqual(parts[2].settledAt);
  });

  it("без части мастеру выплата не завершена; оплата — это HOLD, а не подтверждённый возврат", () => {
    const hold = entry("HOLD", money.buyerTotalTiyn);
    const release = entry("RELEASE", 1n);
    expect(moneyFacts([hold, release, entry("SPLIT_PLATFORM", 1n, "SUCCEEDED", { parentId: release.id })]).payoutSettled).toBe(false);
    expect(moneyFacts([hold, entry("REFUND", money.buyerTotalTiyn)]).heldEntry).toBe(hold);
  });

  it("операции подтверждены не по порядку журнала (оператор manual) — завершение по самому позднему итогу", () => {
    const hold = entry("HOLD", money.buyerTotalTiyn);
    const [release, master, platform] = payout();
    const late = { ...master, settledAt: new Date(platform.settledAt!.getTime() + 3600_000) };
    const block = view([hold, release, late, platform]);
    expect(block.kind === "completed" && block.completedAt).toEqual(late.settledAt);
  });

  it("время резервирования — итог оплаты, а не запись", () => {
    const hold = entry("HOLD", money.buyerTotalTiyn);
    expect(view([hold])).toMatchObject({ reservedAt: hold.settledAt });
    expect(hold.settledAt).not.toEqual(hold.createdAt);
  });
});

describe("повторы после отказа банка — по последней попытке", () => {
  const hold = () => entry("HOLD", money.buyerTotalTiyn);

  it("часть мастеру отклонена и повторена под тем же раскрытием — выплата завершена, сумма не задвоена", () => {
    const [release, master, platform] = payout();
    const failed = { ...master, status: "FAILED" as const };
    const retried = entry("SPLIT_MASTER", master.amountTiyn, "SUCCEEDED", { parentId: release.id });
    const entries = [hold(), release, failed, platform, retried];
    expect(moneyFacts(entries)).toMatchObject({ payoutSettled: true, paidToMasterTiyn: money.payoutTiyn });
    expect(view(entries)).toMatchObject({ kind: "completed", settled: true, paidToMasterTiyn: money.payoutTiyn, bankBalanceTiyn: 0n });
    expect(moneyFacts([hold(), release, failed, platform]).payoutSettled).toBe(false);
  });

  it("раскрытие отклонено и повторено целиком — завершение по новому раскрытию и его частям", () => {
    const first = entry("RELEASE", money.buyerTotalTiyn, "FAILED");
    const firstParts = [entry("SPLIT_MASTER", money.payoutTiyn, "FAILED", { parentId: first.id }), entry("SPLIT_PLATFORM", money.platformIncomeTiyn, "FAILED", { parentId: first.id })];
    expect(moneyFacts([hold(), first, ...firstParts])).toMatchObject({ releaseEntry: null, payoutSettled: false, exitRequested: true });
    expect(moneyFacts([hold(), first, ...firstParts, ...payout()])).toMatchObject({ payoutSettled: true, bankBalanceTiyn: 0n });
  });

  it("раздел по спору: раскрытие отклонено, остаток возвращён — это не «возврат целиком»", () => {
    const entries = [hold(), entry("RELEASE", 1n, "FAILED"), entry("REFUND", 1n)];
    expect(moneyFacts(entries)).toMatchObject({ refundSettled: false, payoutSettled: false });
    expect(view(entries).kind).not.toBe("refunded");
  });

  it("возврат отклонён и повторён — refundSettled по последней попытке", () => {
    const failed = entry("REFUND", money.buyerTotalTiyn, "FAILED");
    expect(moneyFacts([hold(), failed]).refundSettled).toBe(false);
    expect(moneyFacts([hold(), failed, entry("REFUND", money.buyerTotalTiyn)])).toMatchObject({ refundSettled: true, refundedTiyn: money.buyerTotalTiyn });
  });

  it("что можно повторить: отклонённую последнюю попытку; часть — при подтверждённом раскрытии", () => {
    const [release, master] = payout();
    const failedMaster = { ...master, status: "FAILED" as const };
    const failedRefund = entry("REFUND", 1n, "FAILED");
    const entries = [hold(), release, failedMaster, failedRefund];
    expect(retryCheck(entries, failedMaster)).toBe("retriable");
    expect(retryCheck(entries, failedRefund)).toBe("retriable");
    expect(retryCheck(entries, release)).toBe("notFailed");
    expect(retryCheck([entry("HOLD", 1n, "FAILED")], { id: "x", type: "HOLD", status: "FAILED", parentId: null })).toBe("notRetriable");
    const again = entry("SPLIT_MASTER", master.amountTiyn, "PENDING", { parentId: release.id });
    expect(retryCheck([...entries, again], failedMaster)).toBe("superseded");
    const failedRelease = entry("RELEASE", 1n, "FAILED");
    const orphan = entry("SPLIT_MASTER", 1n, "FAILED", { parentId: failedRelease.id });
    expect(retryCheck([hold(), failedRelease, orphan], orphan)).toBe("parentNotSettled");
    expect(retryCheck([hold(), failedRelease, orphan], failedRelease)).toBe("retriable");
  });
});

describe("история денег", () => {
  it("порядок — по seq, даже если записи пришли вперемешку", () => {
    const items = moneyHistoryOf([...payout(), entry("REFUND", 1n)].reverse());
    expect(items.map((i) => i.type)).toEqual(["SPLIT_MASTER", "SPLIT_PLATFORM", "REFUND"]);
    const block = view([entry("HOLD", money.buyerTotalTiyn), ...payout()].reverse());
    expect(block).toMatchObject({ kind: "completed", settled: true });
  });

  it("по порядку, без служебного RELEASE; части выплаты ссылаются на акт", () => {
    const items = moneyHistoryOf([entry("HOLD", money.buyerTotalTiyn, "SUCCEEDED", { basisDocumentId: "contract-1" }), ...payout()]);
    expect(items.map((i) => i.type)).toEqual(["HOLD", "SPLIT_MASTER", "SPLIT_PLATFORM"]);
    expect(items.map((i) => i.basisDocumentId)).toEqual(["contract-1", "act-1", "act-1"]);
  });
});
