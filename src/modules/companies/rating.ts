import "server-only";
import type { RecalculateRating } from "./types";

/**
 * Пересчёт рейтинга с нуля по отзывам и завершённым сделкам: идемпотентен.
 * Вызывается deal-core в транзакции создания отзыва.
 * Строка профиля блокируется первой: параллельный отзыв ждёт и затем видит уже закоммиченный соседний.
 * NO KEY UPDATE, а не UPDATE: вставка отзыва держит KEY SHARE на профиле (внешний ключ), с FOR UPDATE была бы взаимоблокировка.
 */
export const recalculateRating: RecalculateRating = async (tx, executorId) => {
  await tx.$queryRaw`SELECT id FROM "ExecutorProfile" WHERE id = ${executorId} FOR NO KEY UPDATE`;
  // Запросы в одной транзакции — по очереди: соединение одно, параллельные запросы на нём pg не поддерживает.
  const stats = await tx.review.aggregate({ where: { executorId }, _avg: { rating: true }, _count: { _all: true } });
  const completedDeals = await tx.deal.count({ where: { executorId, status: "COMPLETED" } });
  await tx.executorProfile.update({
    where: { id: executorId },
    data: { ratingAvg: round2(stats._avg.rating ?? 0), reviewsCount: stats._count._all, completedDeals },
  });
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
