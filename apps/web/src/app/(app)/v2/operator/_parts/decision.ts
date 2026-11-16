"use client";

import { useRouter } from "next/navigation";
import type { RefObject } from "react";
import { toast, useQueueDecision } from "@/kit";

/**
 * Решение принято (форма ответила успехом): в очереди решений — итог в общую область `role="status"` очереди и фокус на
 * соседнюю карточку после обновления экрана (`anchor` — элемент внутри карточки: форма или обёртка кнопок; форма в окне
 * живёт в портале и карточку не находит); вне очереди (карточка исполнителя) — тост. Затем экран обновляется: решённая
 * карточка уходит, число очереди меняется. Двойное решение гасит модуль (CONFLICT), не этот помощник.
 */
export function useDecisionDone(anchor: RefObject<HTMLElement | null>): (text: string) => void {
  const decided = useQueueDecision();
  const router = useRouter();
  return (text) => {
    if (decided) decided(text, anchor.current);
    else toast(text);
    router.refresh();
  };
}
