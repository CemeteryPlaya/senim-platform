import type { CurrentUser } from "@/modules/identity";
import type { CompleteSigning, CreateContract, CreateStageAct } from "@/modules/documents";
import type { RecalculateRating } from "@/modules/companies";
import { sha256Hex } from "@/platform/crypto";
import { transaction, type Tx } from "@/platform/db";
import { fail } from "@/platform/errors";
import { ru } from "@/i18n/ru";

/**
 * Зависимости deal-core от других модулей — в одном месте.
 *
 * Направление импортов: deal-core → documents и deal-core → companies. Обратных импортов нет:
 * documents получает deal-core.onDocumentSigned как хук (completeSigning(..., { onFullySigned })),
 * поэтому цикла не возникает и регистрация не нужна. Пока реализаций нет в этой ветке —
 * рабочие временные адаптеры ниже (прямые запросы через Prisma с теми же сигнатурами).
 *
 * INTEGRATOR: после слияния documents и companies заменить тело файла на
 *   export { createContract, createStageAct, completeSigning } from "@/modules/documents";
 *   export { recalculateRating } from "@/modules/companies";
 * и удалить временную подпись (экран использует _components/signing).
 */

/** Временная запись документа: без PDF, хэш по реквизитам. */
async function placeholderDocument(
  tx: Tx,
  input: { dealId: string; stageId?: string; kind: "CONTRACT" | "STAGE_ACT"; number: string; fingerprint: string },
) {
  const version = (await tx.document.count({ where: { dealId: input.dealId, kind: input.kind, stageId: input.stageId ?? null } })) + 1;
  const sha256 = sha256Hex(`${input.fingerprint}:v${version}`);
  const file = await tx.storedFile.create({
    data: {
      storageKey: `documents/pending/${input.dealId}/${input.kind.toLowerCase()}-${input.stageId ?? "deal"}-v${version}.pdf`,
      provider: "pending",
      purpose: "DOCUMENT",
      contentType: "application/pdf",
      size: 0,
      sha256,
    },
  });
  const doc = await tx.document.create({
    data: { dealId: input.dealId, stageId: input.stageId, kind: input.kind, version, number: input.number, fileId: file.id, sha256 },
  });
  return { documentId: doc.id, sha256 };
}

// INTEGRATOR: заменить на documents.createContract
export const createContract: CreateContract = async (tx, dealId) => {
  const deal = await tx.deal.findUniqueOrThrow({ where: { id: dealId } });
  const number = `Д-${String(deal.number).padStart(4, "0")}/${deal.createdAt.getUTCFullYear()}`;
  return placeholderDocument(tx, { dealId, kind: "CONTRACT", number, fingerprint: `${deal.id}:${deal.totalAmount}:${deal.stageTemplate}` });
};

// INTEGRATOR: заменить на documents.createStageAct
export const createStageAct: CreateStageAct = async (tx, stageId) => {
  const stage = await tx.stage.findUniqueOrThrow({ where: { id: stageId }, include: { deal: true } });
  const number = `А-${String(stage.deal.number).padStart(4, "0")}-${stage.order}`;
  return placeholderDocument(tx, {
    dealId: stage.dealId,
    stageId,
    kind: "STAGE_ACT",
    number,
    fingerprint: `${stage.id}:${stage.amount}:${stage.acceptedAt?.toISOString() ?? ""}`,
  });
};

// INTEGRATOR: заменить на documents.completeSigning (подпись ЭЦП через _components/signing).
// Временная условная подпись стороной: без CMS, verified = false. Сигнатура — как у CompleteSigning,
// кроме sessionId: сессии подписи здесь нет.
export const completeSigning = async (
  user: CurrentUser,
  input: { documentId: string },
  hooks: Parameters<CompleteSigning>[2],
): Promise<{ fullySigned: boolean }> =>
  transaction(async (tx) => {
    const doc = await tx.document.findUnique({ where: { id: input.documentId }, include: { deal: true, signatures: true } });
    const party =
      doc?.deal.clientId === user.id ? "CLIENT" : user.executor && doc?.deal.executorId === user.executor.id ? "EXECUTOR" : null;
    if (!doc || !party) return fail.notFound(ru.deal.errors.notFound);
    if (doc.status !== "SIGNING") return fail.conflict(ru.deal.errors.notAllowedNow);
    await tx.signature.createMany({
      data: [
        {
          documentId: doc.id,
          userId: user.id,
          party,
          method: "MOCK",
          signedSha256: doc.sha256,
          signature: "temporary-unsigned",
          certSubject: user.fullName ?? user.phone,
          certSerial: "TEMP",
        },
      ],
      skipDuplicates: true,
    });
    const count = await tx.signature.count({ where: { documentId: doc.id } });
    if (count < 2) return { fullySigned: false };
    const signed = await tx.document.updateMany({ where: { id: doc.id, status: "SIGNING" }, data: { status: "SIGNED", signedAt: new Date() } });
    if (signed.count === 1) await hooks.onFullySigned(tx, doc.id);
    return { fullySigned: true };
  });

// INTEGRATOR: заменить на companies.recalculateRating
export const recalculateRating: RecalculateRating = async (tx, executorId) => {
  const stats = await tx.review.aggregate({ where: { executorId }, _avg: { rating: true }, _count: true });
  const completedDeals = await tx.deal.count({ where: { executorId, status: "COMPLETED" } });
  await tx.executorProfile.update({
    where: { id: executorId },
    data: { ratingAvg: Math.round((stats._avg.rating ?? 0) * 100) / 100, reviewsCount: stats._count, completedDeals },
  });
};
