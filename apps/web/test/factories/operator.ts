import type { RequestStatus } from "@/generated/prisma/enums";
import { openDispute, submitDisputePosition } from "@/modules/deal-core";
import { db } from "@/platform/db";
import { makeClient, makeExecutor } from "../factories";
import { dealAt, type DealFixture } from "./deal";

/** Фабрики панели оператора: заявки и отклики для «заявок без откликов», споры настоящим путём deal-core. */

export async function makeRequest(opts: { status?: RequestStatus; publishedHoursAgo?: number; clientId?: string } = {}) {
  const clientId = opts.clientId ?? (await makeClient()).id;
  const publishedAt = opts.publishedHoursAgo === undefined ? null : new Date(Date.now() - opts.publishedHoursAgo * 3600_000);
  return db.request.create({
    data: { clientId, mode: "TENDER", segment: "COMFORT", status: opts.status ?? "OPEN", publishedAt, wizardStep: 4 },
  });
}

export async function makeOffer(requestId: string, opts: { status?: "SENT" | "WITHDRAWN" | "DECLINED" | "ACCEPTED" } = {}) {
  const executor = await makeExecutor();
  return db.offer.create({
    data: { requestId, executorId: executor.executor.id, priceTiyn: 500_000_00n, durationDays: 30, warrantyMonths: 12, measurementTerms: "FREE", status: opts.status ?? "SENT" },
  });
}

/** Открытый спор в сделке, где идут работы: покупатель открыл, обе стороны написали позиции. */
export async function makeDispute(opts: { provider?: "mock" | "manual" } = {}): Promise<DealFixture & { disputeId: string }> {
  const f = await dealAt("IN_PROGRESS", { provider: opts.provider });
  const { disputeId } = await openDispute(f.client, { dealId: f.dealId, reason: "QUALITY", description: "Фасады с царапинами" });
  await submitDisputePosition(f.client, { disputeId, position: "Нужна замена фасадов" });
  await submitDisputePosition(f.executor, { disputeId, position: "Царапины появились при монтаже техники" });
  return { ...f, disputeId };
}
