"use client";

import { ChevronRight, Loader2 } from "lucide-react";
import { useLinkStatus } from "next/link";

/**
 * Шеврон строки-ссылки (`ListRow` с `href`): пока переход по строке идёт (`useLinkStatus`, ссылка не загружена заранее),
 * на его месте — индикатор того же размера, проявляется через 150 мс (`pending-reveal`): на быстрой сети не мигает,
 * раскладка не сдвигается. Скрыт от диктора: переход объявит новый экран. Вне `Link` — обычный шеврон.
 */
export function RowChevron() {
  const { pending } = useLinkStatus();
  if (pending) {
    // Проявление — на обёртке: у самого значка своя анимация (вращение; при меньшем движении — пульсация, app.css).
    return (
      <span aria-hidden data-row-pending className="pending-reveal flex size-4 shrink-0">
        <Loader2 className="size-4 animate-spin text-muted" />
      </span>
    );
  }
  return <ChevronRight aria-hidden className="size-4 shrink-0 text-muted" />;
}
