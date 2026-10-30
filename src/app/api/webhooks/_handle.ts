import { handleRailWebhook } from "@/modules/deal-core";
import type { RailMode } from "@/modules/payments";
import { isAppError } from "@/platform/errors";
import { httpStatusOf, readTextLimited } from "@/platform/http";
import { logger } from "@/platform/logger";

/**
 * Общий обработчик вебхуков рельса. Это вход «банк → платформа»: пользователя нет,
 * подлинность — HMAC-подпись (rail.parseWebhook), тело разбирается zod-схемой там же.
 * Ответ 2xx — событие принято (в том числе повтор); 5xx — банк должен доставить снова.
 */
const MAX_BODY = 64 * 1024;

export async function railWebhook(mode: RailMode, request: Request): Promise<Response> {
  const rawBody = await readTextLimited(request, MAX_BODY);
  if (rawBody === null) return Response.json({ ok: false, error: "PAYLOAD_TOO_LARGE" }, { status: 413 });
  try {
    const outcome = await handleRailWebhook(mode, { headers: request.headers, rawBody });
    return Response.json({ ok: true, duplicate: outcome.duplicate, eventId: outcome.event.eventId });
  } catch (e) {
    if (isAppError(e)) return Response.json({ ok: false, error: e.code }, { status: httpStatusOf(e.code) });
    logger.error("rail webhook failed", { mode, error: e });
    return Response.json({ ok: false, error: "INTERNAL" }, { status: 500 });
  }
}
