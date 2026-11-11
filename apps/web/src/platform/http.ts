import { z } from "zod";
import { ru } from "@/i18n/ru";
import { fail, isAppError, type ErrorCode } from "./errors";
import { logger } from "./logger";

const STATUS: Record<ErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  MFA_REQUIRED: 403,
  CONSENT_REQUIRED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  UNAVAILABLE: 503,
};

/** HTTP-статус для кода ошибки приложения. */
export function httpStatusOf(code: ErrorCode): number {
  return STATUS[code];
}

/** Ошибка маршрута → JSON { code, error } с понятным текстом; неожиданные — 500 без подробностей и запись в лог. */
export function errorResponse(e: unknown, route: string): Response {
  if (isAppError(e)) return Response.json({ code: e.code, error: e.message }, { status: STATUS[e.code] });
  logger.error("route failed", { route, error: e });
  return Response.json({ code: "INTERNAL", error: ru.common.errors.generic }, { status: 500 });
}

const idParams = z.object({ id: z.string().min(1).max(64) });

/** id из параметров маршрута `[id]`. Неверный id — NOT_FOUND, как у несуществующего объекта. */
export async function routeId(params: Promise<unknown>, notFoundMessage?: string): Promise<string> {
  const parsed = idParams.safeParse(await params);
  return parsed.success ? parsed.data.id : fail.notFound(notFoundMessage);
}

/**
 * Тело запроса текстом, но не больше maxBytes: отказ по content-length до чтения, а без него —
 * обрыв потока на лимите. null — тело больше лимита (ответьте 413). Защита от памяти,
 * забитой гигантским телом, на входах без сессии (вебхуки).
 */
export async function readTextLimited(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBytes) return null;
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
