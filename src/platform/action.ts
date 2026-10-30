import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { type ErrorCode, isAppError } from "./errors";
import { logger } from "./logger";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: ErrorCode | "INTERNAL"; error: string; fieldErrors?: Record<string, string[]> };

const INTERNAL_ERROR = "Что-то пошло не так. Попробуйте ещё раз";

/**
 * Обёртка Server Action: разбирает вход zod-схемой и превращает ошибки в результат.
 * Проверку сессии и роли делает `handler` (через identity.requireUser) — первой строкой.
 * redirect()/notFound() из Next.js пропускаются наружу.
 */
export function action<S extends z.ZodType, T>(name: string, schema: S, handler: (input: z.infer<S>) => Promise<T>) {
  return async (raw: z.input<S>): Promise<ActionResult<T>> => {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const flat = z.flattenError(parsed.error);
      return {
        ok: false,
        code: "VALIDATION",
        error: flat.formErrors[0] ?? "Проверьте заполнение полей",
        fieldErrors: flat.fieldErrors as Record<string, string[]>,
      };
    }
    try {
      return { ok: true, data: await handler(parsed.data) };
    } catch (e) {
      unstable_rethrow(e);
      if (isAppError(e)) return { ok: false, code: e.code, error: e.message, ...fieldErrorsOf(e.details) };
      logger.error("action failed", { action: name, error: e });
      return { ok: false, code: "INTERNAL", error: INTERNAL_ERROR };
    }
  };
}

/** Ошибки по полям из сервиса (fail.validation(msg, { fieldErrors })) — чтобы форма показала их у полей. */
function fieldErrorsOf(details: unknown): { fieldErrors?: Record<string, string[]> } {
  if (typeof details !== "object" || details === null || !("fieldErrors" in details)) return {};
  const fe = (details as { fieldErrors: unknown }).fieldErrors;
  return typeof fe === "object" && fe !== null ? { fieldErrors: fe as Record<string, string[]> } : {};
}
