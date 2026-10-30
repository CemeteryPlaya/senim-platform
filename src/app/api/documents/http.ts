import { type ErrorCode, isAppError } from "@/platform/errors";
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

/** Ошибка сервиса → JSON-ответ с кодом; неожиданные — 500 с записью в лог. */
export function errorResponse(e: unknown, route: string): Response {
  if (isAppError(e)) return Response.json({ code: e.code, error: e.message }, { status: STATUS[e.code] });
  logger.error("route failed", { route, error: e });
  return Response.json({ code: "INTERNAL", error: "Что-то пошло не так. Попробуйте ещё раз" }, { status: 500 });
}

/** inline-показ PDF; имя с кириллицей — через filename* (RFC 6266/5987), ASCII-запасное — document.pdf. */
export function pdfDisposition(fileName: string): string {
  return `inline; filename="document.pdf"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
