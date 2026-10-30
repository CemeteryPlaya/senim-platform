import { handleRailWebhook } from "@/modules/deal-core";
import type { RailMode } from "@/modules/payments";
import { isAppError, type ErrorCode } from "@/platform/errors";
import { logger } from "@/platform/logger";

/**
 * Общий обработчик вебхуков рельса. Это вход «банк → платформа»: пользователя нет,
 * подлинность — HMAC-подпись (rail.parseWebhook), тело разбирается zod-схемой там же.
 * Ответ 2xx — событие принято (в том числе повтор); 5xx — банк должен доставить снова.
 */
const STATUS: Record<ErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  UNAVAILABLE: 503,
};
const MAX_BODY = 64 * 1024;

export async function railWebhook(mode: RailMode, request: Request): Promise<Response> {
  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY) return Response.json({ ok: false, error: "PAYLOAD_TOO_LARGE" }, { status: 413 });
  try {
    const outcome = await handleRailWebhook(mode, { headers: request.headers, rawBody });
    return Response.json({ ok: true, duplicate: outcome.duplicate, eventId: outcome.event.eventId });
  } catch (e) {
    if (isAppError(e)) return Response.json({ ok: false, error: e.code }, { status: STATUS[e.code] });
    logger.error("rail webhook failed", { mode, error: e });
    return Response.json({ ok: false, error: "INTERNAL" }, { status: 500 });
  }
}
