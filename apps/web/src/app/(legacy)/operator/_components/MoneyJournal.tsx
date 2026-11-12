import { ru } from "@/i18n/ru";
import type { JournalRow } from "@/modules/operator";
import type { MoneyBlock } from "@/modules/payments";
import { Alert, DateText, StatusBadge, formatDate, type Tone } from "@/ui";
import { formatTiyn } from "@/ui/format";

const t = ru.operator.money;
const c = ru.operator.deals.card;

const STATUS_TONE: Record<JournalRow["status"], Tone> = { PENDING: "warning", SUCCEEDED: "success", FAILED: "danger" };

/** Журнал денег сделки для оператора и банка: каждая операция с ключом идемпотентности и документом банка. */
export function MoneyJournal({ rows }: { rows: readonly JournalRow[] }) {
  if (rows.length === 0) return <p className="text-base text-muted">{c.journalEmpty}</p>;
  return (
    <ol className="flex flex-col">
      {rows.map((r) => (
        <li key={r.id} className="flex min-w-0 flex-col gap-1 border-b border-line py-3 last:border-b-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted tabular-nums">
              {ru.operator.audit.seq}
              {r.seq}
            </span>
            <StatusBadge tone={STATUS_TONE[r.status]}>{t.status[r.status]}</StatusBadge>
            {r.isTest && <StatusBadge tone="neutral">{ru.operator.testMark}</StatusBadge>}
          </div>
          <p className="flex flex-wrap items-baseline justify-between gap-x-3 font-semibold text-ink">
            <span className="min-w-0 break-words">{t.types[r.type]}</span>
            <span className="tabular-nums">{formatTiyn(r.amountTiyn)}</span>
          </p>
          <p className="text-sm text-ink-soft">
            <DateText value={r.createdAt} format="dateTime" />
            {r.settledAt && (
              <>
                {" — "}
                <DateText value={r.settledAt} format="dateTime" />
              </>
            )}
          </p>
          {r.bankDocNumber && r.bankDocDate && <p className="text-sm break-words text-ink-soft">{c.bankDoc(r.bankDocNumber, formatDate(r.bankDocDate))}</p>}
          {r.error && <p className="text-sm break-words text-danger">{c.error(r.error)}</p>}
          <p className="text-sm break-all text-muted">{c.key(r.idempotencyKey)}</p>
        </li>
      ))}
    </ol>
  );
}

/** Блок денег по журналу, формулировки для оператора (у оператора «эскроу» допустимо). */
export function MoneyBlockView({ money }: { money: MoneyBlock }) {
  const b = c.moneyBlock;
  const view = (() => {
    switch (money.kind) {
      case "awaiting":
        return { tone: "info" as const, text: b.awaiting };
      case "protected":
        return { tone: "success" as const, text: b.protected(formatTiyn(money.amountTiyn)) };
      case "frozen":
        return { tone: "warning" as const, text: b.frozen(formatTiyn(money.amountTiyn)) };
      case "completed":
        return { tone: "success" as const, text: money.settled ? b.completed(formatTiyn(money.paidToMasterTiyn)) : b.completedPending(formatTiyn(money.paidToMasterTiyn)) };
      case "refunded":
        return { tone: "info" as const, text: money.settled ? b.refunded(formatTiyn(money.amountTiyn)) : b.refundedPending(formatTiyn(money.amountTiyn)) };
    }
  })();
  return (
    <Alert tone={view.tone} title={view.text}>
      <span className="flex flex-col gap-1">
        <span>{c.bankBalance(formatTiyn(money.bankBalanceTiyn))}</span>
        {money.isTest && <span>{c.test}</span>}
      </span>
    </Alert>
  );
}
