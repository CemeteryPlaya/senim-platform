import { buildCsv, csvSchema } from "@/modules/operator";
import { requireUser } from "@/modules/identity";
import { isAppError } from "@/platform/errors";

const STATUS: Record<string, number> = { UNAUTHENTICATED: 401, FORBIDDEN: 403, VALIDATION: 400, NOT_FOUND: 404 };

/** GET /operator/report/csv?kind=deals&staleDays=3 — выгрузка отчёта для Excel. Только оператор. */
export async function GET(request: Request) {
  try {
    const user = await requireUser("OPERATOR");
    const input = csvSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!input.success) return new Response(null, { status: 400 });
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
    if (isAppError(e)) return new Response(e.message, { status: STATUS[e.code] ?? 409 });
    throw e;
  }
}
