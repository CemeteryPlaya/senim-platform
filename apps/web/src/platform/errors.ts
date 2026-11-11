import { ru } from "@/i18n/ru";

/**
 * Ошибки приложения. `message` показывается пользователю как есть,
 * поэтому пишется по-русски и без технических подробностей.
 */
export type ErrorCode =
  | "VALIDATION"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "MFA_REQUIRED" // нужен (свежий) код второго фактора оператора: форма спросит код и повторит действие
  | "CONSENT_REQUIRED" // нет действующего согласия на обработку ПДн текущей редакции: форма уводит на экран согласия
  | "NOT_FOUND"
  | "CONFLICT" // состояние уже изменилось: повтор, гонка, неверный статус
  | "RATE_LIMITED"
  | "UNAVAILABLE"; // внешний сервис недоступен

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

const e = ru.common.errors;

export const fail = {
  validation(message: string, details?: Record<string, unknown>): never {
    throw new AppError("VALIDATION", message, details);
  },
  unauthenticated(message: string = e.unauthenticated): never {
    throw new AppError("UNAUTHENTICATED", message);
  },
  forbidden(message: string = e.notAllowed): never {
    throw new AppError("FORBIDDEN", message);
  },
  /** Отказ по правам особого вида: второй фактор оператора не пройден или пройден давно (MFA_STEP_UP_WINDOW). */
  mfaRequired(message: string = ru.identity.mfa.stepUp): never {
    throw new AppError("MFA_REQUIRED", message);
  },
  /** Как UNAUTHENTICATED, но причина — согласие: нет действующего согласия на обработку ПДн текущей редакции. */
  consentRequired(message: string = ru.consent.screen.lead): never {
    throw new AppError("CONSENT_REQUIRED", message);
  },
  notFound(message: string = e.notFoundShort): never {
    throw new AppError("NOT_FOUND", message);
  },
  /** details — машинная причина отказа для вызывающего кода и тестов (например, `{ reason: "BANK_CONSENT_MISSING" }`). */
  conflict(message: string = e.conflict, details?: Record<string, unknown>): never {
    throw new AppError("CONFLICT", message, details);
  },
  rateLimited(message: string = e.rateLimited): never {
    throw new AppError("RATE_LIMITED", message);
  },
  unavailable(message: string = e.unavailable): never {
    throw new AppError("UNAVAILABLE", message);
  },
};

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

/**
 * Условное обновление (`updateMany` с проверкой текущего статуса) изменило не одну строку:
 * статус уже поменял кто-то другой — двойной клик или параллельный запрос.
 */
export function expectOneUpdated(result: { count: number }, message?: string): void {
  if (result.count !== 1) fail.conflict(message);
}
