import { Landmark, Lock } from "lucide-react";
import { moneyOf, type DealFull } from "@/lib/deal/query";
import { dateTime, tenge } from "@/lib/format";
import { Card } from "@/components/ui";

const TX_LABEL = { DEPOSIT: "Пополнение", RELEASE: "Выплата мастеру", COMMISSION: "Комиссия 6%", REFUND: "Возврат заказчику" };

export function EscrowCard({ deal }: { deal: DealFull }) {
  const m = moneyOf(deal);
  const pct = (v: number) => (deal.amount ? (v / deal.amount) * 100 : 0);
  const closed = m.funded > 0 && m.frozen === 0;
  const label = closed ? "Эскроу-счёт закрыт · выплачено" : m.funded ? "Заморожено на эскроу" : "Сумма сделки";
  const headline = closed ? m.toMaster + m.commission : m.funded ? m.frozen : deal.amount;

  return (
    <Card className="overflow-hidden">
      <div className="bg-brand p-5 text-white">
        <div className="flex items-center justify-between text-xs text-white/70">
          <span className="flex items-center gap-1.5">
            <Lock size={13} /> {label}
          </span>
          {deal.escrow && <span>{deal.escrow.bank}</span>}
        </div>
        <div className="tabular mt-1 text-3xl font-extrabold">{tenge(headline)}</div>
        {m.funded > 0 && (
          <>
            <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-white/15">
              <div className="bg-[#E9B44C]" style={{ width: `${pct(m.toMaster + m.commission)}%` }} />
              <div className="bg-white/60" style={{ width: `${pct(m.refunded)}%` }} />
            </div>
            <div className="mt-1.5 text-[11px] text-white/70">из {tenge(deal.amount)} по договору</div>
          </>
        )}
        {!m.funded && <div className="mt-1 text-xs text-white/70">Ещё не внесена на эскроу-счёт</div>}
      </div>

      <div className="tabular space-y-2 p-5 text-sm">
        <Row label="Выплачено мастеру" value={tenge(m.toMaster)} dot="#E9B44C" />
        <Row label="Комиссия оператора (6%)" value={tenge(m.commission)} />
        {m.refunded > 0 && <Row label="Возвращено заказчику" value={tenge(m.refunded)} />}
        {deal.escrow && (
          <div className="flex items-center gap-1.5 border-t border-line pt-3 text-xs text-muted">
            <Landmark size={13} /> Счёт {deal.escrow.iban}
          </div>
        )}
        {deal.transactions.length > 0 && (
          <details className="group pt-1">
            <summary className="cursor-pointer text-xs font-semibold text-brand select-none">
              Журнал проводок ({deal.transactions.length})
            </summary>
            <ul className="mt-2 space-y-1.5 text-xs">
              {deal.transactions.map((t) => (
                <li key={t.id} className="flex justify-between gap-2">
                  <span className="text-muted">
                    {dateTime(t.createdAt)} · {TX_LABEL[t.type]}
                  </span>
                  <span className={t.type === "DEPOSIT" ? "font-semibold text-brand" : ""}>
                    {t.type === "DEPOSIT" ? "+" : "−"}
                    {tenge(t.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Card>
  );
}

function Row({ label, value, dot }: { label: string; value: string; dot?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-muted">
        {dot && <span className="h-2 w-2 rounded-full" style={{ background: dot }} />}
        {label}
      </span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
