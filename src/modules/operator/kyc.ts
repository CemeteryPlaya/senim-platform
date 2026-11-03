// KYC мастера (ТЗ п. 9, решение 2.2.8): очередь и решение — сервис identity (переходы kyc-policy, журнал,
// уведомление мастеру). Оператор только смотрит удостоверение и регистрацию и ставит VERIFIED или REJECTED.
export { kycQueue, kycReviewSchema, reviewKyc, type KycDocument, type KycQueueItem, type KycReviewInput } from "@/modules/identity";
