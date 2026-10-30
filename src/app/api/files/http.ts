import { isAppError, type ErrorCode } from "@/platform/errors";
import { logger } from "@/platform/logger";

const STATUS: Record<ErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  UNAVAILABLE: 503,
};

/** Ошибка маршрута → JSON { error } с понятным текстом; неожиданные — 500 без подробностей. */
export function errorResponse(e: unknown, route: string): Response {
  if (isAppError(e)) return Response.json({ code: e.code, error: e.message }, { status: STATUS[e.code] });
  logger.error("route failed", { route, error: e });
  return Response.json({ code: "INTERNAL", error: "Что-то пошло не так. Попробуйте ещё раз" }, { status: 500 });
}
