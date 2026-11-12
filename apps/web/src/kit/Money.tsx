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

/**
 * Сумма денег. Цифры табличные, строка не переносится. Цвет — ink (в том числе значением строки списка, где
 * остальные значения muted); `tone="inherit"` — цвет окружения (сумма внутри вторичного текста).
 */
export function Money({ tiyn, tone = "ink" }: { tiyn: bigint; tone?: "ink" | "inherit" }) {
  return <span className={cn("whitespace-nowrap tabular-nums", tone === "ink" && "text-ink")}>{formatMoney(tiyn)}</span>;
}
