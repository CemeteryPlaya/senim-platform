import type { MoneyTransaction } from "@/generated/prisma/client";
import type { MoneyTransactionType, PaymentProviderKind } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { db, type Db, type Tx } from "@/platform/db";
import { expectOneUpdated, fail } from "@/platform/errors";
import { moneyFacts, moneyHistoryOf, projectMoney, type LedgerEntry, type MoneyBlock, type MoneyFacts, type MoneyHistoryItem } from "./projection";

/**
 * Журнал денег (ADR-009 раздел 4) — единственный источник правды. Только добавление: запись операции
 * и её итог. Триггер БД запрещает DELETE и изменение суммы, типа, сделки и ключа.
 */

export type RecordInput = {
  dealId: string;
  type: MoneyTransactionType;
  amountTiyn: bigint;
  idempotencyKey: string;
  provider: PaymentProviderKind;
  isTest: boolean;
  parentId?: string;
  disputeId?: string;
  basisDocumentId?: string | null;
  actorId?: string | null;
  /** FREEZE и UNFREEZE деньги не двигают и банку не отправляются: записываются сразу выполненными. */
  settledNow?: boolean;
};

/**
 * Записывает операцию; повтор с тем же ключом возвращает уже записанную (created: false), а не дубль.
 * Тот же ключ с другой сделкой, типом или суммой — ошибка вызывающего: такую операцию не подменяем.
 */
export async function recordOperation(tx: Tx, input: RecordInput): Promise<{ entry: MoneyTransaction; created: boolean }> {
  const now = new Date();
  const { settledNow, ...data } = input;
  const inserted = await tx.moneyTransaction.createMany({
    data: [{ ...data, status: settledNow ? "SUCCEEDED" : "PENDING", settledAt: settledNow ? now : null }],
    skipDuplicates: true,
  });
  const entry = await tx.moneyTransaction.findUniqueOrThrow({ where: { idempotencyKey: input.idempotencyKey } });
  if (entry.dealId !== input.dealId || entry.type !== input.type || entry.amountTiyn !== input.amountTiyn) {
    return fail.conflict(ru.payments.errors.keyReused);
  }
  return { entry, created: inserted.count === 1 };
}

export type Outcome =
  | { status: "SUCCEEDED"; externalRef?: string | null }
  | { status: "FAILED"; error: string; externalRef?: string | null };

/** Подтверждение оператором (manual): реквизиты банковского документа и кто подтвердил. */
export type BankConfirmation = { confirmedById: string; bankDocNumber: string; bankDocDate: Date; bankDocFileId: string };

/**
 * Итог операции: PENDING → SUCCEEDED | FAILED. Условное обновление «where status = PENDING»: из двух
 * одновременных итогов (вебхук и опрос, двойной клик оператора) проходит один. null — итог уже был.
 */
export async function trySettle(tx: Tx, id: string, outcome: Outcome, confirmation?: BankConfirmation): Promise<MoneyTransaction | null> {
  const settledAt = new Date();
  const result = await tx.moneyTransaction.updateMany({
    where: { id, status: "PENDING" },
    data: {
      status: outcome.status,
      settledAt,
      error: outcome.status === "FAILED" ? outcome.error : null,
      ...(outcome.externalRef ? { externalRef: outcome.externalRef } : {}),
      ...confirmation,
    },
  });
  if (result.count !== 1) return null;
  const settled = await tx.moneyTransaction.findUniqueOrThrow({ where: { id } });
  // Банк отклонил раскрытие — его части не отправлялись и уже не будут: повтор раскрытия создаст новые (retry.ts).
  if (settled.type === "RELEASE" && settled.status === "FAILED") {
    await tx.moneyTransaction.updateMany({ where: { parentId: id, status: "PENDING" }, data: { status: "FAILED", settledAt, error: ru.payments.errors.parentFailed } });
  }
  return settled;
}

/** То же, но повтор — ошибка CONFLICT: для действий человека (оператор подтверждает операцию). */
export async function settle(tx: Tx, id: string, outcome: Outcome, confirmation?: BankConfirmation): Promise<MoneyTransaction> {
  const settled = await trySettle(tx, id, outcome, confirmation);
  expectOneUpdated({ count: settled ? 1 : 0 }, ru.payments.errors.notPending);
  return settled!;
}

/** Провайдер принял операцию, но итога ещё нет: запоминаем его номер (меняется только у PENDING). */
export async function rememberExternalRef(tx: Db, id: string, externalRef: string): Promise<void> {
  await tx.moneyTransaction.updateMany({ where: { id, status: "PENDING", externalRef: null }, data: { externalRef } });
}

// ─── проекции ────────────────────────────────────────────────────────────────

/** Что подгружать к операции журнала для проекций: доля мастера по спору (у раскрытия частичного раздела). */
export const LEDGER_INCLUDE = { dispute: { select: { masterShareTiyn: true } } } as const;

/** Строка журнала (с LEDGER_INCLUDE) → запись для проекций. */
export function toLedgerEntry({ dispute, ...row }: MoneyTransaction & { dispute: { masterShareTiyn: bigint | null } | null }): LedgerEntry {
  return { ...row, disputeShareTiyn: row.type === "RELEASE" ? (dispute?.masterShareTiyn ?? null) : null };
}

export async function ledgerEntries(client: Db, dealId: string): Promise<LedgerEntry[]> {
  const rows = await client.moneyTransaction.findMany({ where: { dealId }, orderBy: { seq: "asc" }, include: LEDGER_INCLUDE });
  return rows.map(toLedgerEntry);
}

/** Факты о деньгах сделки — для условий переходов deal-core (в той же транзакции). */
export async function moneyFactsOf(client: Db, dealId: string): Promise<MoneyFacts> {
  return moneyFacts(await ledgerEntries(client, dealId));
}

/**
 * Блок денег по журналу. Из сделки берётся только снимок цены X (для «Защита сделки» в итоге), статус — нет.
 * Доступ проверяет вызывающий (deal-core: стороны сделки и оператор).
 */
export async function moneyView(dealId: string, client: Db = db): Promise<MoneyBlock> {
  // По очереди: в транзакции соединение одно, параллельных запросов на нём pg не поддерживает.
  const entries = await ledgerEntries(client, dealId);
  const deal = await client.deal.findUniqueOrThrow({ where: { id: dealId }, select: { priceTiyn: true } });
  return projectMoney(entries, deal);
}

export async function moneyHistory(dealId: string, client: Db = db): Promise<MoneyHistoryItem[]> {
  return moneyHistoryOf(await ledgerEntries(client, dealId));
}
