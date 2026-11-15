import { cn } from "./cn";

const NBSP = " ";
const MINUS = "−";

/**
 * Сумма в тиынах (1 тенге = 100 тиын) → «1 224 000 ₸». Только целые числа: ни одного float.
 * Тиыны показываются, когда сумма не кратна 100 («1 224 000,50 ₸»). Минус — U+2212.
 */
export function formatMoney(tiyn: bigint): string {
  const negative = tiyn < 0n;
  const abs = negative ? -tiyn : tiyn;
  const tenge = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const rest = abs % 100n;
  const fraction = rest === 0n ? "" : `,${rest.toString().padStart(2, "0")}`;
  return `${negative ? MINUS : ""}${tenge}${fraction}${NBSP}₸`;
}

export type MoneyProps = {
  tiyn: bigint;
  /** `ink` (по умолчанию) — цвет ink; `inherit` — цвет окружения (сумма внутри вторичного текста, на фото). */
  tone?: "ink" | "inherit";
  /**
   * Крупная сумма (герой экрана, блок денег, сводка): знак «₸» — 0,6 размера суммы (`text-currency`, разбор 3.6),
   * у `ink` — цветом muted: цифры главнее знака. В строках и тексте не ставится — там знак полного размера.
   */
  large?: boolean;
};

/**
 * Сумма денег. Цифры табличные, строка не переносится. Цвет — ink (в том числе значением строки списка, где
 * остальные значения muted). Текст суммы для диктора и копирования один — `formatMoney`.
 */
export function Money({ tiyn, tone = "ink", large = false }: MoneyProps) {
  const full = formatMoney(tiyn);
  const className = cn("whitespace-nowrap tabular-nums", tone === "ink" && "text-ink");
  if (!large) return <span className={className}>{full}</span>;
  return (
    <span className={className}>
      {full.slice(0, -1)}
      <span data-currency className={cn("text-currency", tone === "ink" && "text-muted")}>
        ₸
      </span>
    </span>
  );
}
