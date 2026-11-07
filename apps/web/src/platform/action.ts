import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";
import { ru } from "@/i18n/ru";
import { type ErrorCode, isAppError } from "./errors";
import { logger } from "./logger";
import { fieldErrorsOf as zodFieldErrors } from "./validation";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: ErrorCode | "INTERNAL"; error: string; fieldErrors?: Record<string, string[]> };

/**
 * Обёртка Server Action: разбирает вход zod-схемой и превращает ошибки в результат.
 * Проверку сессии и роли делает `handler` (через identity.requireUser) — первой строкой.
 * redirect()/notFound() из Next.js пропускаются наружу.
 */
export function action<S extends z.ZodType, T>(name: string, schema: S, handler: (input: z.infer<S>) => Promise<T>) {
  return async (raw: z.input<S>): Promise<ActionResult<T>> => {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      // Сверху — общий текст, у полей — их сообщения (форма покажет их под полями).
      const formError = parsed.error.issues.find((issue) => issue.path.length === 0)?.message;
      return { ok: false, code: "VALIDATION", error: formError ?? ru.common.errors.invalid, fieldErrors: zodFieldErrors(parsed.error) };
    }
    try {
      return { ok: true, data: await handler(parsed.data) };
    } catch (e) {
      unstable_rethrow(e);
      if (isAppError(e)) return { ok: false, code: e.code, error: e.message, ...fieldErrorsOf(e.details) };
      logger.error("action failed", { action: name, error: e });
      return { ok: false, code: "INTERNAL", error: ru.common.errors.generic };
    }
  };
}

/** Ошибки по полям из сервиса (fail.validation(msg, { fieldErrors })) — чтобы форма показала их у полей. */
function fieldErrorsOf(details: unknown): { fieldErrors?: Record<string, string[]> } {
  if (typeof details !== "object" || details === null || !("fieldErrors" in details)) return {};
  const fe = (details as { fieldErrors: unknown }).fieldErrors;
  return typeof fe === "object" && fe !== null ? { fieldErrors: fe as Record<string, string[]> } : {};
}
