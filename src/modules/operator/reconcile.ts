import type { ReconciliationRow, StatementEntry } from "@/modules/payments";

/** Операция из нашего журнала (PaymentOperation), которую сверяем с выпиской банка. */
export type JournalOperation = {
  dealId: string;
  kind: "DEPOSIT" | "RELEASE" | "REFUND";
  amount: number;
  idempotencyKey: string;
  externalRef: string | null;
  status: "PENDING" | "SUCCEEDED" | "FAILED";
};

/**
 * Сверка журнала с выпиской: запись банка ищется по ключу идемпотентности, затем по ссылке банка.
 * Неуспешные операции денег не двигали — в сверку не идут. Лишние записи выписки — MISSING_IN_JOURNAL.
 */
export function matchStatement(dealId: string, operations: JournalOperation[], statement: StatementEntry[]): ReconciliationRow[] {
  const unused = new Set(statement);
  const take = (predicate: (e: StatementEntry) => boolean) => {
    const found = [...unused].find(predicate);
    if (found) unused.delete(found);
    return found;
  };

  const rows: ReconciliationRow[] = operations
    .filter((op) => op.status !== "FAILED")
    .map((op) => {
      const bank =
        take((e) => e.idempotencyKey === op.idempotencyKey) ?? (op.externalRef ? take((e) => e.externalRef === op.externalRef) : undefined);
      const matched = bank && bank.amount === op.amount && bank.kind === op.kind;
      return {
        dealId,
        idempotencyKey: op.idempotencyKey,
        externalRef: op.externalRef ?? bank?.externalRef ?? null,
        kind: op.kind,
        ourAmount: op.amount,
        bankAmount: bank?.amount ?? null,
        status: !bank ? "MISSING_IN_BANK" : matched ? "MATCHED" : "AMOUNT_MISMATCH",
      };
    });

  for (const e of unused) {
    rows.push({
      dealId,
      idempotencyKey: e.idempotencyKey ?? null,
      externalRef: e.externalRef,
      kind: e.kind,
      ourAmount: null,
      bankAmount: e.amount,
      status: "MISSING_IN_JOURNAL",
    });
  }
  return rows;
}
