import "server-only";
import { env } from "@/platform/env";

export type * from "./provider";

/** Все функции ИИ скрыты, если AI_ENABLED=false. Провайдеры и помощник — ai-engineer (фаза B). */
export function aiEnabled(): boolean {
  return env().AI_ENABLED;
}

export const jobHandlers = {} as const;
