import { ru } from "@/i18n/ru";
import { fileUrl } from "@/modules/files";
import type { CurrentUser } from "@/modules/identity";
import { db } from "@/platform/db";
import { fail } from "@/platform/errors";
import { logger } from "@/platform/logger";
import { roleIn } from "./state";

/**
 * Фото последнего спора сделки: подписанные срочные адреса (`fileUrl`), в порядке загрузки. Права те же, что у самого
 * спора (`getDealView`): стороны сделки и оператор; чужая и несуществующая сделка — «не найдено». Нет спора — пусто.
 * Отдельное чтение, чтобы `getDealView` (карточка, список) не тянул файлы, которые нужны одному экрану.
 */
export async function disputePhotos(user: CurrentUser, dealId: string): Promise<{ id: string; src: string }[]> {
  const deal = await db.deal.findUnique({
    where: { id: dealId },
    select: { clientId: true, executorId: true, disputes: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true } } },
  });
  if (!deal || !roleIn(user, deal)) return fail.notFound(ru.deal.errors.notFound);
  const dispute = deal.disputes[0];
  if (!dispute) return [];
  const files = await db.storedFile.findMany({
    where: { disputeId: dispute.id, purpose: "DISPUTE" },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, provider: true, storageKey: true },
  });
  const out: { id: string; src: string }[] = [];
  for (const file of files) {
    try {
      out.push({ id: file.id, src: await fileUrl(file) });
    } catch (error) {
      logger.warn("dispute photo url failed", { fileId: file.id, error });
    }
  }
  return out;
}
