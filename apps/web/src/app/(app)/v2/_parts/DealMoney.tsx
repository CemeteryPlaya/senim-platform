import { Money } from "@/kit";
import type { DealMoneyLine } from "./deal-summary";

/**
 * Деньги в карточке сделки списка и главной — одним блоком: сумма 22 px / 600 и подпись из журнала под ней («в банке под
 * защитой», «вы получите после приёмки»). Справа от названия на компьютере; при нехватке места уходит строкой ниже целиком —
 * подпись от суммы не отрывается. Суммы нет (выплата у покупателя, спор у мастера) — только подпись.
 */
export function DealMoney({ money }: { money: DealMoneyLine }) {
  return (
    <p className="flex flex-col items-end gap-0.5 text-right">
      {money.amountTiyn !== null && (
        <span className="text-title-2 tabular-nums text-ink">
          <Money tiyn={money.amountTiyn} />
        </span>
      )}
      <span className="text-sub text-muted">{money.label}</span>
    </p>
  );
}
