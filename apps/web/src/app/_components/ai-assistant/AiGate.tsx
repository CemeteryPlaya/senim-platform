import type { ReactNode } from "react";
import { aiEnabled } from "@/modules/ai";

/**
 * Серверный компонент: показывает ИИ-блоки только при AI_ENABLED=true.
 * Импортируется по полному пути (`@/app/_components/ai-assistant/AiGate`), не из index:
 * index нужен и клиентским экранам, а этот файл читает окружение сервера.
 */
export function AiGate({ children }: { children: ReactNode }) {
  return aiEnabled() ? children : null;
}
