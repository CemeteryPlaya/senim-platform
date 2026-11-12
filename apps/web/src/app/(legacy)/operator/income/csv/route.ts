import { requireUser } from "@/modules/identity";
import { buildIncomeCsv, incomePeriodSchema } from "@/modules/operator";
import { errorResponse, httpStatusOf } from "@/platform/http";

/** GET /operator/income/csv?from=2026-11-01&to=2026-11-30 — доход платформы за период для Excel. Только оператор. */
export async function GET(request: Request) {
  try {
    const user = await requireUser("OPERATOR");
    const params = new URL(request.url).searchParams;
    const input = incomePeriodSchema.safeParse({ from: params.get("from"), to: params.get("to") });
    if (!input.success) return new Response(null, { status: httpStatusOf("VALIDATION") });
    const csv = await buildIncomeCsv(user, input.data);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="senim-income-${params.get("from")}-${params.get("to")}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return errorResponse(e, "operator.income.csv");
  }
}
