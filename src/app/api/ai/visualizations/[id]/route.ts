import { z } from "zod";
import { errorResponse } from "@/app/api/files/http";
import { getVisualization } from "@/modules/ai";
import { requireUser } from "@/modules/identity";
import { fail } from "@/platform/errors";

const params = z.object({ id: z.string().min(1).max(64) });

/** Опрос статуса ИИ-иллюстрации из компонента мастера заявки. Ответ не кэшируется. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser("CLIENT", "OPERATOR");
    const parsed = params.safeParse(await ctx.params);
    if (!parsed.success) return fail.notFound();
    const view = await getVisualization(user, parsed.data.id);
    return Response.json(view, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e, "api.ai.visualizations.get");
  }
}
