import type { FilePurpose } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { ru } from "@/i18n/ru";
import type { Tx } from "@/platform/db";
import { expectOneUpdated } from "@/platform/errors";

/** Файл ещё ни к чему не прикреплён: все поля-владельцы пусты. */
const UNATTACHED = {
  portfolioItemId: null,
  requestId: null,
  progressReportId: null,
  dealId: null,
  executorProfileId: null,
  disputeId: null,
  messageId: null,
  visualizationId: null,
} satisfies Prisma.StoredFileWhereInput;

type Owner = { dealId: string } | { progressReportId: string } | { disputeId: string };
const PURPOSE: Record<"dealId" | "progressReportId" | "disputeId", FilePurpose> = {
  dealId: "DELIVERY",
  progressReportId: "PROGRESS_REPORT",
  disputeId: "DISPUTE",
};

/**
 * Прикрепить свои загруженные фото к сделке (сдача), отчёту «Ход работ» или спору. Только свои, ещё не
 * прикреплённые и нужного назначения — иначе CONFLICT и откат транзакции вызывающего. Порядок — порядок списка.
 * INTEGRATOR: заменить на files.attachFiles (то же правило), когда files узнает эти поля-владельцы.
 */
export async function attachOwnFiles(tx: Tx, input: { fileIds: readonly string[]; uploadedById: string; owner: Owner }): Promise<void> {
  const [field, ownerId] = Object.entries(input.owner)[0] as [keyof typeof PURPOSE, string];
  for (const [i, id] of input.fileIds.entries()) {
    const result = await tx.storedFile.updateMany({
      where: { id, uploadedById: input.uploadedById, purpose: PURPOSE[field], ...UNATTACHED },
      data: { [field]: ownerId, sortOrder: i },
    });
    expectOneUpdated(result, ru.deal.errors.photoNotOwn);
  }
}
