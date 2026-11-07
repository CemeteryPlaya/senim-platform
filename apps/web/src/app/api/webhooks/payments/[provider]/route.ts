import { z } from "zod";
import { onMoneySettled } from "@/modules/deal-core";
import { receiveWebhook } from "@/modules/payments";
import { isAppError } from "@/platform/errors";
import { httpStatusOf, readTextLimited } from "@/platform/http";
import { logger } from "@/platform/logger";

/**
 * Вебхук платёжного провайдера (ТЗ п. 10): вход «провайдер → платформа», пользователя нет.
 * Подлинность проверяет провайдер (handleWebhook: подпись), повтор отсекает PaymentWebhookEvent.externalEventId,
 * итог операции ищется по ключу идемпотентности. Ответ — тот, которого ждёт провайдер; 5xx — доставить снова.
 */
const MAX_BODY = 64 * 1024;
const providerParam = z.object({ provider: z.enum(["mock", "manual", "freedompay"]) });

export async function POST(request: Request, ctx: RouteContext<"/api/webhooks/payments/[provider]">): Promise<Response> {
  const parsed = providerParam.safeParse(await ctx.params);
  if (!parsed.success) return Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  const body = await readTextLimited(request, MAX_BODY);
  if (body === null) return Response.json({ ok: false, error: "PAYLOAD_TOO_LARGE" }, { status: 413 });
  try {
    const { response } = await receiveWebhook(parsed.data.provider, request.headers, body, onMoneySettled);
    return new Response(response.body, { status: response.status, headers: { "content-type": response.contentType } });
  } catch (e) {
    if (isAppError(e)) return Response.json({ ok: false, error: e.code }, { status: httpStatusOf(e.code) });
    logger.error("payment webhook failed", { provider: parsed.data.provider, error: e });
    return Response.json({ ok: false, error: "INTERNAL" }, { status: 500 });
  }
}
