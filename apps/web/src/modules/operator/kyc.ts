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
