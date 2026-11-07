import { errorResponse } from "@/app/api/files/http";
import { getVisualization } from "@/modules/ai";
import { requireUser } from "@/modules/identity";
import { routeId } from "@/platform/http";

/** Опрос статуса ИИ-иллюстрации из компонента мастера заявки. Ответ не кэшируется. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser("CLIENT", "OPERATOR");
    const view = await getVisualization(user, await routeId(ctx.params));
    return Response.json(view, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e, "api.ai.visualizations.get");
  }
}
