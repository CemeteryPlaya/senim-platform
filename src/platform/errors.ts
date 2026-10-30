/**
 * Ошибки приложения. `message` показывается пользователю как есть,
 * поэтому пишется по-русски и без технических подробностей.
 */
export type ErrorCode =
  | "VALIDATION"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
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

export const fail = {
  validation(message: string, details?: Record<string, unknown>): never {
    throw new AppError("VALIDATION", message, details);
  },
  unauthenticated(message = "Войдите, чтобы продолжить"): never {
    throw new AppError("UNAUTHENTICATED", message);
  },
  forbidden(message = "Недостаточно прав для этого действия"): never {
    throw new AppError("FORBIDDEN", message);
  },
  notFound(message = "Не найдено"): never {
    throw new AppError("NOT_FOUND", message);
  },
  conflict(message = "Данные уже изменились. Обновите страницу"): never {
    throw new AppError("CONFLICT", message);
  },
  rateLimited(message = "Слишком много попыток. Попробуйте позже"): never {
    throw new AppError("RATE_LIMITED", message);
  },
  unavailable(message = "Сервис временно недоступен. Попробуйте позже"): never {
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
