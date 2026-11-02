import "server-only";
import { z } from "zod";
import type { KycStatus, LegalForm } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { recordAudit } from "@/modules/audit";
import { fileUrl } from "@/modules/files";
import { notify } from "@/modules/notifications";
import { db, transaction, type Db } from "@/platform/db";
import { expectOneUpdated, fail } from "@/platform/errors";
import { parseInput } from "@/platform/validation";
import { ownExecutorId } from "./executor-guard";
import { attachKycFiles, type KycPurpose } from "./kyc-files";
import { kycTarget, kycView, type KycFacts, type KycState } from "./kyc-policy";
import { actorOf, type CurrentUser } from "./session";

/**
 * KYC мастера (решение 2.2.8): загрузка документов мастером и решение оператора. Правило переходов —
 * kyc-policy.ts; здесь — транзакции, журнал и уведомления. Документы — файлы модуля files с владельцем
 * executorProfileId; старые документы после отказа остаются в истории (оператор видит все, новые — первыми).
 */
export const KYC_MAX_FILES = 4;
export const KYC_REASON_MIN = 3;
export const KYC_REASON_MAX = 500;
/** Ссылки на документы в очереди оператора живут недолго: это удостоверения личности. */
const DOC_URL_TTL_SEC = 15 * 60;

const t = ru.identity.kyc;
const fileId = z.string().min(1).max(64);

export const kycSubmitSchema = z.object({
  idFileIds: z.array(fileId).min(1, t.errors.needId).max(KYC_MAX_FILES),
  registrationFileIds: z.array(fileId).min(1, t.errors.needRegistration).max(KYC_MAX_FILES),
});
export type KycSubmitInput = z.input<typeof kycSubmitSchema>;

const reasonText = t.reasonLength(KYC_REASON_MIN, KYC_REASON_MAX);
/** Причина обязательна при отказе (3–500 символов после trim); при подтверждении не пишется. */
export const kycReviewSchema = z
  .object({ executorId: fileId, decision: z.enum(["VERIFIED", "REJECTED"]), reason: z.string().trim().max(KYC_REASON_MAX, reasonText).optional() })
  .superRefine((v, ctx) => {
    if (v.decision === "REJECTED" && (v.reason ?? "").length < KYC_REASON_MIN) ctx.addIssue({ code: "custom", path: ["reason"], message: reasonText });
  });
export type KycReviewInput = z.input<typeof kycReviewSchema>;

const entityOf = (executorId: string) => ({ entity: { type: "executor", id: executorId }, scope: `executor:${executorId}` });

async function documentCounts(client: Db, executorId: string): Promise<Record<KycPurpose, number>> {
  const rows = await client.storedFile.groupBy({
    by: ["purpose"],
    where: { executorProfileId: executorId, purpose: { in: ["KYC_ID", "KYC_REGISTRATION"] } },
    _count: { _all: true },
  });
  const count = (purpose: KycPurpose) => rows.find((r) => r.purpose === purpose)?._count._all ?? 0;
  return { KYC_ID: count("KYC_ID"), KYC_REGISTRATION: count("KYC_REGISTRATION") };
}

async function factsOf(client: Db, executorId: string): Promise<(KycFacts & { rejectReason: string | null; counts: Record<KycPurpose, number> }) | null> {
  const profile = await client.executorProfile.findUnique({ where: { id: executorId }, select: { kycStatus: true, kycRejectReason: true } });
  if (!profile) return null;
  const counts = await documentCounts(client, executorId);
  return { status: profile.kycStatus, hasDocuments: counts.KYC_ID > 0 && counts.KYC_REGISTRATION > 0, rejectReason: profile.kycRejectReason, counts };
}

export type OwnKyc = { state: KycState; canSubmit: boolean; rejectReason: string | null; documents: { id: number; registration: number } };

/** Экран мастера «Проверка документов»: состояние, причина отказа, сколько файлов загружено. */
export async function getOwnKyc(user: CurrentUser): Promise<OwnKyc> {
  const executorId = ownExecutorId(user);
  const facts = (await factsOf(db, executorId)) ?? fail.notFound(t.errors.notFound);
  return {
    ...kycView(facts),
    rejectReason: facts.status === "REJECTED" ? facts.rejectReason : null,
    documents: { id: facts.counts.KYC_ID, registration: facts.counts.KYC_REGISTRATION },
  };
}

/**
 * Мастер отправляет документы на проверку: файлы прикрепляются к профилю, статус — PENDING (после отказа —
 * снова PENDING, причина снимается). Переход — updateMany по ожидаемым статусам + expectOneUpdated: проверенные
 * документы параллельная загрузка не перезапишет. Повтор с теми же файлами — отказ (файлы уже прикреплены).
 */
export async function submitKycDocuments(user: CurrentUser, raw: KycSubmitInput): Promise<void> {
  const executorId = ownExecutorId(user);
  const input = parseInput(kycSubmitSchema, raw);
  await transaction(async (tx) => {
    const facts = (await factsOf(tx, executorId)) ?? fail.notFound(t.errors.notFound);
    const to = kycTarget("submit", facts, user.role);
    expectOneUpdated(
      await tx.executorProfile.updateMany({
        where: { id: executorId, kycStatus: { in: ["PENDING", "REJECTED"] } },
        data: { kycStatus: to, kycRejectReason: null },
      }),
      t.errors.alreadyVerified,
    );
    await attachKycFiles(tx, { fileIds: [...new Set(input.idFileIds)], uploadedById: user.id, executorProfileId: executorId, purpose: "KYC_ID" });
    await attachKycFiles(tx, { fileIds: [...new Set(input.registrationFileIds)], uploadedById: user.id, executorProfileId: executorId, purpose: "KYC_REGISTRATION" });
    await recordAudit(tx, {
      actor: actorOf(user),
      action: "executor.kyc_submitted",
      ...entityOf(executorId),
      before: { status: facts.status },
      after: { status: to },
      meta: { idFiles: input.idFileIds.length, registrationFiles: input.registrationFileIds.length },
    });
    const { legalName } = await tx.executorProfile.findUniqueOrThrow({ where: { id: executorId }, select: { legalName: true } });
    const operators = await tx.user.findMany({ where: { roles: { has: "OPERATOR" }, blockedAt: null }, select: { id: true } });
    for (const op of operators) {
      await notify(tx, { userId: op.id, kind: "kyc.submitted", title: t.notifyOperator.title, body: t.notifyOperator.body(legalName), link: "/operator/kyc" });
    }
  });
}

export type KycDocument = { id: string; purpose: KycPurpose; contentType: string; createdAt: Date; url: string };
export type KycQueueItem = {
  executorId: string;
  publicNumber: number;
  legalForm: LegalForm;
  legalName: string;
  binIinLast4: string;
  /** Все документы профиля, новые первыми (после отказа старые остаются в истории). */
  documents: KycDocument[];
  lastUploadAt: Date;
};

function requireOperator(user: CurrentUser): void {
  if (user.role !== "OPERATOR") fail.forbidden();
}

/**
 * operator → identity: очередь проверки — мастера в PENDING с обоими видами документов, давно ждущие первыми.
 * Ссылки на файлы выдаются здесь, после проверки роли (ADR-003: право — при выдаче ссылки), и живут 15 минут.
 */
export async function kycQueue(operator: CurrentUser): Promise<KycQueueItem[]> {
  requireOperator(operator);
  const profiles = await db.executorProfile.findMany({
    where: {
      kycStatus: "PENDING",
      AND: [{ kycDocuments: { some: { purpose: "KYC_ID" } } }, { kycDocuments: { some: { purpose: "KYC_REGISTRATION" } } }],
    },
    select: {
      id: true,
      publicNumber: true,
      legalForm: true,
      legalName: true,
      binIinLast4: true,
      kycDocuments: {
        where: { purpose: { in: ["KYC_ID", "KYC_REGISTRATION"] } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true, purpose: true, contentType: true, createdAt: true, provider: true, storageKey: true },
      },
    },
  });
  const items = await Promise.all(
    profiles.map(async (p) => ({
      executorId: p.id,
      publicNumber: p.publicNumber,
      legalForm: p.legalForm,
      legalName: p.legalName,
      binIinLast4: p.binIinLast4,
      lastUploadAt: p.kycDocuments[0]!.createdAt,
      documents: await Promise.all(
        p.kycDocuments.map(async (d) => ({
          id: d.id,
          purpose: d.purpose as KycPurpose,
          contentType: d.contentType,
          createdAt: d.createdAt,
          url: await fileUrl(d, { expiresInSec: DOC_URL_TTL_SEC }),
        })),
      ),
    })),
  );
  return items.sort((a, b) => a.lastUploadAt.getTime() - b.lastUploadAt.getTime());
}

/**
 * operator → identity: решение по документам. VERIFIED или REJECTED с причиной (3–500 символов).
 * Переход — updateMany по «ещё PENDING» + expectOneUpdated: двойной клик и два оператора одновременно дают
 * одно решение, второй — CONFLICT. В той же транзакции — журнал и уведомление мастеру.
 */
export async function reviewKyc(operator: CurrentUser, raw: KycReviewInput): Promise<void> {
  requireOperator(operator);
  const input = parseInput(kycReviewSchema, raw);
  const reason = input.decision === "REJECTED" ? (input.reason ?? null) : null;
  await transaction(async (tx) => {
    const facts = (await factsOf(tx, input.executorId)) ?? fail.notFound(t.errors.notFound);
    const to: KycStatus = kycTarget(input.decision === "VERIFIED" ? "verify" : "reject", facts, operator.role);
    expectOneUpdated(
      await tx.executorProfile.updateMany({
        where: { id: input.executorId, kycStatus: "PENDING" },
        data: { kycStatus: to, kycRejectReason: reason, kycReviewedAt: new Date() },
      }),
      t.errors.reviewed,
    );
    await recordAudit(tx, {
      actor: actorOf(operator),
      action: to === "VERIFIED" ? "executor.kyc_verified" : "executor.kyc_rejected",
      ...entityOf(input.executorId),
      before: { status: facts.status },
      after: reason ? { status: to, reason } : { status: to },
    });
    const { userId } = await tx.executorProfile.findUniqueOrThrow({ where: { id: input.executorId }, select: { userId: true } });
    const n = t.notifyExecutor;
    await notify(
      tx,
      to === "VERIFIED"
        ? { userId, kind: "kyc.verified", title: n.verifiedTitle, body: n.verifiedBody, link: "/executor/profile/kyc" }
        : { userId, kind: "kyc.rejected", title: n.rejectedTitle, body: n.rejectedBody(reason ?? ""), link: "/executor/profile/kyc" },
    );
  });
}
