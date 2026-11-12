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

/** Сумма денег. Цифры табличные, строка не переносится. */
export function Money({ tiyn }: { tiyn: bigint }) {
  return <span className="whitespace-nowrap tabular-nums">{formatMoney(tiyn)}</span>;
}
