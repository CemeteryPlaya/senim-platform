"use client";

import { useEffect } from "react";
import { Notice } from "@/kit";

/**
 * Разовая плашка «Заявка отправлена». После показа убирает `?sent=1` из адреса без перезагрузки и без нового запроса к
 * серверу (`history.replaceState` Next синхронизирует с роутером): плашка остаётся на экране, а при обновлении страницы
 * или возврате по истории уже не появляется.
 */
export function SentNotice({ title, text, href }: { title: string; text: string; href: string }) {
  useEffect(() => {
    window.history.replaceState(window.history.state, "", href);
  }, [href]);
  return (
    <Notice tone="info" title={title}>
      {text}
    </Notice>
  );
}
