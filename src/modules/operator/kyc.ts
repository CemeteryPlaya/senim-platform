import type { KycStatus, LegalForm } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { recordAudit } from "@/modules/audit";
import { fileUrl } from "@/modules/files";
import { actorOf, type CurrentUser } from "@/modules/identity";
import { notify } from "@/modules/notifications";
import { db, transaction } from "@/platform/db";
import { expectOneUpdated } from "@/platform/errors";
import { assertOperator } from "./access";
import type { ReviewKycInput } from "./schemas";

/**
 * KYC мастера (ТЗ п. 9, Handover): оператор смотрит удостоверение и регистрацию ИП/ТОО и ставит
 * VERIFIED или REJECTED с причиной.
 * INTEGRATOR: заменить на identity.kycQueue и identity.reviewKyc (их делает idco-агент) — сигнатуры те же:
 * kycQueue(operator) → KycQueueItem[], reviewKyc(operator, { profileId, decision, reason? }) → void.
 */

export type KycDocumentView = { id: string; purpose: "KYC_ID" | "KYC_REGISTRATION"; contentType: string; url: string; createdAt: Date };

export type KycQueueItem = {
  profileId: string;
  publicNumber: number;
  legalForm: LegalForm;
  legalName: string;
  binIinLast4: string;
  kycStatus: KycStatus;
  submittedAt: Date;
  documents: KycDocumentView[];
};

/** Мастера с KYC на проверке, у которых есть хотя бы один документ, — старые сверху. */
export async function kycQueue(operator: CurrentUser): Promise<KycQueueItem[]> {
  assertOperator(operator);
  const rows = await db.executorProfile.findMany({
    where: { kycStatus: "PENDING", kycDocuments: { some: {} } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      publicNumber: true,
      legalForm: true,
      legalName: true,
      binIinLast4: true,
      kycStatus: true,
      createdAt: true,
      kycDocuments: { orderBy: { createdAt: "asc" }, select: { id: true, purpose: true, contentType: true, provider: true, storageKey: true, createdAt: true } },
    },
  });
  return Promise.all(
    rows.map(async (r) => ({
      profileId: r.id,
      publicNumber: r.publicNumber,
      legalForm: r.legalForm,
      legalName: r.legalName,
      binIinLast4: r.binIinLast4,
      kycStatus: r.kycStatus,
      submittedAt: r.kycDocuments[0]?.createdAt ?? r.createdAt,
      documents: await Promise.all(
        r.kycDocuments
          .filter((d): d is typeof d & { purpose: KycDocumentView["purpose"] } => d.purpose === "KYC_ID" || d.purpose === "KYC_REGISTRATION")
          .map(async ({ provider, storageKey, ...d }) => ({ ...d, url: await fileUrl({ provider, storageKey }) })),
      ),
    })),
  );
}

/** Решение по KYC: только из PENDING (двойной клик — CONFLICT), аудит и уведомление мастеру в одной транзакции. */
export async function reviewKyc(operator: CurrentUser, input: ReviewKycInput): Promise<void> {
  assertOperator(operator);
  const t = ru.operator.kyc;
  await transaction(async (tx) => {
    const reason = input.decision === "REJECTED" ? input.reason : null;
    const updated = await tx.executorProfile.updateMany({
      where: { id: input.profileId, kycStatus: "PENDING" },
      data: { kycStatus: input.decision, kycRejectReason: reason, kycReviewedAt: new Date() },
    });
    expectOneUpdated(updated, t.alreadyReviewed);
    const profile = await tx.executorProfile.findUniqueOrThrow({ where: { id: input.profileId }, select: { userId: true } });
    await recordAudit(tx, {
      actor: actorOf(operator),
      action: input.decision === "VERIFIED" ? "executor.kyc.verified" : "executor.kyc.rejected",
      entity: { type: "executor", id: input.profileId },
      scope: `executor:${input.profileId}`,
      before: { kycStatus: "PENDING" },
      after: { kycStatus: input.decision, reason },
    });
    await notify(tx, {
      userId: profile.userId,
      kind: input.decision === "VERIFIED" ? "executor.kyc.verified" : "executor.kyc.rejected",
      title: input.decision === "VERIFIED" ? t.verifiedTitle : t.rejectedTitle,
      body: input.decision === "VERIFIED" ? t.verifiedBody : t.rejectedBody(reason ?? ""),
      link: "/executor/profile",
    });
  });
}
