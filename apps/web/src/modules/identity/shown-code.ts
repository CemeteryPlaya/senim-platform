import { env } from "@/platform/env";
import { logger } from "@/platform/logger";

/**
 * Можно ли показать на экране код входа, который identity вернула при мок-провайдере (SMS или письма). Код решает identity
 * (`IDENTITY_OTP_PROVIDER`, `IDENTITY_EMAIL_PROVIDER`), а не `SMS_PROVIDER` web, поэтому вторая линия здесь: в production-
 * сборке без пароля стенда (`STAND_ACCESS_PASSWORD`) код не показывается — иначе любой, кто знает адрес, войдёт любым
 * человеком сида, включая оператора. Dev-сервер — без требования (слушает машину разработчика). Открытый стенд
 * (`STAND_OPEN=true`, вне prod — env.ts) показывает код без пароля: решение владельца 26.11.2026.
 */
export function mayShowCode(input: { nodeEnv: string | undefined; standPassword: string | undefined; standOpen?: boolean }): boolean {
  return input.nodeEnv !== "production" || Boolean(input.standPassword) || input.standOpen === true;
}

/** Код от identity для экрана или null; скрытый код — запись в журнал с подсказкой, что задать. */
export function shownCodeOf(code: string): string | null {
  if (code === "") return null;
  if (mayShowCode({ nodeEnv: process.env.NODE_ENV, standPassword: env().STAND_ACCESS_PASSWORD, standOpen: env().STAND_OPEN })) return code;
  logger.warn("identity.shown_code.hidden", { hint: "production-сборка без STAND_ACCESS_PASSWORD и STAND_OPEN: код входа на экране не показывается" });
  return null;
}
