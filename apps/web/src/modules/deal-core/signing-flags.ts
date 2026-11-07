import { isEnabled } from "@/platform/features";
import type { SigningFlags } from "./signatures";

/** Флаги, от которых зависят требуемые подписи (ADR-009 раздел 8). */
export const signingFlags = (): SigningFlags => ({ executorHandSignsAct: isEnabled("executorHandSignsAct") });
