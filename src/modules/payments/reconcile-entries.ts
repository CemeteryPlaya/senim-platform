import type { PaymentOperationKind, PaymentOperationStatus } from "@/generated/prisma/enums";
import type { StatementEntry } from "./rail";

export type ReconciliationRow = {
  dealId: string;
  idempotencyKey: string | null;
  externalRef: string | null;
  kind: "DEPOSIT" | "RELEASE" | "REFUND";
  ourAmount: number | null; // по PaymentOperation
  bankAmount: number | null; // по выписке рельса
  status: "MATCHED" | "MISSING_IN_BANK" | "MISSING_IN_JOURNAL" | "AMOUNT_MISMATCH";
};

export type JournalOperation = {
  idempotencyKey: string;
  externalRef: string | null;
  kind: PaymentOperationKind;
  amount: number;
  status: PaymentOperationStatus;
};

/**
 * Сверка журнала платформы (PaymentOperation) с выпиской банка. Чистая функция.
 * Сопоставление: по ключу идемпотентности, иначе по номеру операции банка (так находятся пополнения).
 * Неуспешная операция, которой нет в банке, — норма и в отчёт не попадает.
 */
export function reconcileEntries(dealId: string, ops: JournalOperation[], statement: StatementEntry[]): ReconciliationRow[] {
  const unmatched = [...statement];
  const take = (op: JournalOperation) => {
    // У записи выписки номер банка есть всегда: операция без номера (null) по нему не совпадёт.
    const i = unmatched.findIndex((e) => e.idempotencyKey === op.idempotencyKey || e.externalRef === op.externalRef);
    return i === -1 ? undefined : unmatched.splice(i, 1)[0];
  };

  const rows: ReconciliationRow[] = [];
  for (const op of ops) {
    const bank = take(op);
    if (op.status === "FAILED") {
      // Журнал считает операцию несостоявшейся, а банк деньги двинул — это расхождение.
      if (bank) rows.push(row(dealId, op.idempotencyKey, bank.externalRef, bank.kind, null, bank.amount, "MISSING_IN_JOURNAL"));
      continue;
    }
    if (!bank) {
      rows.push(row(dealId, op.idempotencyKey, op.externalRef, op.kind, op.amount, null, "MISSING_IN_BANK"));
      continue;
    }
    const same = bank.amount === op.amount && bank.kind === op.kind;
    rows.push(row(dealId, op.idempotencyKey, bank.externalRef, op.kind, op.amount, bank.amount, same ? "MATCHED" : "AMOUNT_MISMATCH"));
  }
  for (const bank of unmatched) {
    rows.push(row(dealId, bank.idempotencyKey ?? null, bank.externalRef, bank.kind, null, bank.amount, "MISSING_IN_JOURNAL"));
  }
  return rows;
}

function row(
  dealId: string,
  idempotencyKey: string | null,
  externalRef: string | null,
  kind: ReconciliationRow["kind"],
  ourAmount: number | null,
  bankAmount: number | null,
  status: ReconciliationRow["status"],
): ReconciliationRow {
  return { dealId, idempotencyKey, externalRef, kind, ourAmount, bankAmount, status };
}
