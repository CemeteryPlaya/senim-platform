import { requireUser } from "@/modules/identity";
import { buildCsv, csvSchema } from "@/modules/operator";
import { errorResponse, httpStatusOf } from "@/platform/http";

/**
 * GET /v2/operator/report/csv?kind=deals&staleDays=3 — выгрузка отчёта для Excel (сделки, журнал денег, расхождения).
 * Только оператор (`requireUser("OPERATOR")` первой строкой); неверный вид или число дней — 400. Файл не кэшируется.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser("OPERATOR");
    const input = csvSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!input.success) return new Response(null, { status: httpStatusOf("VALIDATION") });
    const csv = await buildCsv(user, input.data);
    const date = new Date().toISOString().slice(0, 10);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="senim-${input.data.kind}-${date}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return errorResponse(e, "operator.report.csv");
  }
}
