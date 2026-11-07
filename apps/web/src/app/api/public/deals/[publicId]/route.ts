import { getPublicDealView } from "@/modules/deal-core";

/**
 * Публичная обезличенная проекция завершённой сделки (ТЗ п. 8) — фундамент витрины Фазы 2.
 * 404, пока выключен флаг publicShowcase, нет согласия обеих сторон или сделка не завершена.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  const view = /^[\w-]{12,64}$/.test(publicId) ? await getPublicDealView(publicId) : null;
  if (!view) return new Response(null, { status: 404 });
  const body = JSON.stringify(view, (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value));
  return new Response(body, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
