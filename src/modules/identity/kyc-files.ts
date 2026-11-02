import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { ru } from "@/i18n/ru";
import type { Tx } from "@/platform/db";
import { expectOneUpdated } from "@/platform/errors";

/**
 * Прикрепление KYC-документов к профилю мастера (StoredFile.executorProfileId).
 *
 * INTEGRATOR: заменить на files.attachFiles(tx, { fileIds, uploadedById, owner: { executorProfileId } }),
 * когда platform добавит владельца executorProfileId в files (OWNER_PURPOSE: KYC_ID и KYC_REGISTRATION на одно
 * поле — проверка назначения по списку) и KYC_* в PURPOSE_POLICY/UploadPurpose (роль EXECUTOR, imageOrPdf).
 * Сигнатура вызова здесь — та же, плюс purpose: у одного владельца два назначения.
 * Адаптер рабочий: те же условия, что у files.attachFiles — файл свой, нужного назначения и ещё ни к чему
 * не прикреплён; иначе CONFLICT, и транзакция откатывается целиком.
 */
const UNATTACHED = {
  portfolioItemId: null,
  requestId: null,
  progressReportId: null,
  dealId: null,
  executorProfileId: null,
  disputeId: null,
  messageId: null,
  visualizationId: null,
  document: { is: null },
  bankDocFor: { is: null },
  handSignature: { is: null },
} satisfies Prisma.StoredFileWhereInput;

export type KycPurpose = "KYC_ID" | "KYC_REGISTRATION";

export async function attachKycFiles(
  tx: Tx,
  input: { fileIds: readonly string[]; uploadedById: string; executorProfileId: string; purpose: KycPurpose },
): Promise<void> {
  const last = await tx.storedFile.aggregate({ where: { executorProfileId: input.executorProfileId }, _max: { sortOrder: true } });
  const first = (last._max.sortOrder ?? -1) + 1;
  for (const [i, id] of input.fileIds.entries()) {
    const result = await tx.storedFile.updateMany({
      where: { id, uploadedById: input.uploadedById, purpose: input.purpose, ...UNATTACHED },
      data: { executorProfileId: input.executorProfileId, sortOrder: first + i },
    });
    expectOneUpdated(result, ru.identity.kyc.errors.notOwn);
  }
}
