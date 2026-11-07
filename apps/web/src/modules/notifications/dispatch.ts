import { after } from "next/server";
import { runJobNow, type JobHandlers } from "@/platform/jobs";

/**
 * Доставка SMS и push сразу после ответа, а не при следующем проходе очереди (cron на Vercel — раз в сутки).
 *
 * Задачи ставятся в транзакции события (notify): откат транзакции убирает их, и доставлять нечего.
 * После ответа (after из next/server) транзакция уже закоммичена или откатилась — забираем свои задачи
 * по dedupeKey. Задача, которую взял кто-то другой (параллельный проход очереди), не берётся второй раз.
 * Неудача — задача возвращается в очередь с отложенным повтором, её доведёт обычный проход.
 */
export function deliverAfterResponse(handlers: () => JobHandlers, dedupeKeys: readonly string[]): void {
  if (dedupeKeys.length === 0) return;
  try {
    after(async () => {
      for (const key of dedupeKeys) await runJobNow(handlers(), key);
    });
  } catch {
    // Вне запроса Next (фоновые задачи, скрипты, тесты) after недоступен: задачи заберёт очередь.
  }
}
