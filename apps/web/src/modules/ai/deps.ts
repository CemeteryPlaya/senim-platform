import { ru } from "@/i18n/ru";
import { env } from "@/platform/env";
import { fail } from "@/platform/errors";
import type { AiProvider } from "./provider";
import { aiProviderFromEnv } from "./providers/select";

/** Зависимости сервисов ai: по умолчанию — из окружения, в тестах — шпион или сбойный провайдер. */
export type AiDeps = { provider: () => AiProvider };

export const defaultDeps: AiDeps = { provider: aiProviderFromEnv };

/** Все функции ИИ скрыты, если AI_ENABLED=false. */
export function aiEnabled(): boolean {
  return env().AI_ENABLED;
}

export function ensureAiEnabled(): void {
  if (!aiEnabled()) fail.unavailable(ru.ai.errors.disabled);
}
