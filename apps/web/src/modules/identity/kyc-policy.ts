import { KycStatus } from "@/gen/senim/identity/v1/identity_pb";

/**
 * Экран мастера «Проверка документов» (KYC, решение 2.2.8). Переходы (подача, подтверждение, отказ), их таблицу и
 * условный переход решает identity (services/identity/internal/kyc_policy.go); web только показывает состояние.
 * Состояние берётся из статуса identity, а не из проекции: в ExecutorProfile.kycStatus «не подано» и «на проверке» —
 * оба PENDING (в Prisma нет NOT_SUBMITTED), различает их только identity.
 */
/** Пределы — те же, что в identity (kyc_policy.go): web проверяет их на входе, чтобы не звать identity с заведомо неверным. */
export const KYC_MAX_FILES = 4;
export const KYC_REASON_MIN = 3;
export const KYC_REASON_MAX = 500;

export type KycState = "NOT_SUBMITTED" | "PENDING" | "VERIFIED" | "REJECTED";

const STATE: Partial<Record<KycStatus, KycState>> = {
  [KycStatus.NOT_SUBMITTED]: "NOT_SUBMITTED",
  [KycStatus.PENDING]: "PENDING",
  [KycStatus.VERIFIED]: "VERIFIED",
  [KycStatus.REJECTED]: "REJECTED",
};

/** Состояние и можно ли загрузить документы (пока они не проверены). Неизвестный статус — ошибка контракта. */
export function kycView(status: KycStatus): { state: KycState; canSubmit: boolean } {
  const state = STATE[status];
  if (!state) throw new Error(`identity вернул неизвестный статус KYC: ${status}`);
  return { state, canSubmit: state !== "VERIFIED" };
}
