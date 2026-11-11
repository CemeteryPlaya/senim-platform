import "server-only";
import { kycQueueCount, type CurrentUser } from "@/modules/identity";
import { AppError } from "@/platform/errors";

// KYC мастера (ТЗ п. 9, решение 2.2.8): очередь и решение — сервис identity (переходы, журнал); web — ссылки на документы
// с записью о выдаче, проекция и уведомление мастеру. Оператор только смотрит удостоверение и регистрацию и ставит
// VERIFIED или REJECTED.
export {
  kycQueue,
  kycQueueCount,
  kycReviewSchema,
  reviewKyc,
  type KycDecision,
  type KycDocument,
  type KycQueueItem,
  type KycReviewInput,
} from "@/modules/identity";

/**
 * Число мастеров в очереди KYC для главной оператора (Ruling AB): identity недоступен — null (плитка без числа), а не
 * сбой всей главной. Прочие отказы (роль, вторая ступень) — как есть.
 */
export async function kycQueueSize(operator: CurrentUser): Promise<number | null> {
  try {
    return await kycQueueCount(operator);
  } catch (e) {
    if (e instanceof AppError && e.code === "UNAVAILABLE") return null;
    throw e;
  }
}
