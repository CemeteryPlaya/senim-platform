/** Расчёт раздела: суммы в тиынах и сумма мастеру из цены (`shareTiyn`), для которой он сделан. */
export type Preview = { shareTiyn: bigint; masterTiyn: bigint; platformTiyn: bigint; refundTiyn: bigint };

/**
 * Что показать под полем суммы: расчёта нет, он актуален или устарел. Актуален, только если сумма в поле равна той, для
 * которой посчитано: иначе оператор прочёл бы раздел для другой суммы и принял бы решение по чужим цифрам.
 */
export function previewState(preview: Preview | null, shareTiyn: bigint | null): "none" | "fresh" | "stale" {
  if (preview === null) return "none";
  return shareTiyn !== null && preview.shareTiyn === shareTiyn ? "fresh" : "stale";
}
