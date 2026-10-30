import type { DealStatus, PaymentDue, PaymentMode, RequestStatus, StagePaymentStatus, StageStatus } from "@/generated/prisma/enums";
import { db } from "@/platform/db";
import { makeClient, makeExecutor } from "../factories";

/** Фабрики панели оператора: заявки, сделки с этапами и оплатами, споры. */

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
    data: { requestId, executorId: executor.executor.id, price: 500_000, durationDays: 30, warrantyMonths: 12, measurementTerms: "FREE", status: opts.status ?? "SENT" },
  });
}

type StageSpec = { amount: number; status?: StageStatus; paymentDue?: PaymentDue; payment?: StagePaymentStatus; markedPaidDaysAgo?: number };

export async function makeDeal(
  opts: { status?: DealStatus; paymentMode?: PaymentMode; stages?: StageSpec[]; title?: string } = {},
) {
  const client = await makeClient();
  const executor = await makeExecutor();
  const request = await makeRequest({ status: "CLOSED", publishedHoursAgo: 100, clientId: client.id });
  const offer = await db.offer.create({
    data: { requestId: request.id, executorId: executor.executor.id, price: 300_000, durationDays: 20, warrantyMonths: 12, measurementTerms: "FREE", status: "ACCEPTED" },
  });
  const stages = opts.stages ?? [{ amount: 100_000, status: "SUBMITTED", paymentDue: "ON_ACCEPTANCE" }];
  const deal = await db.deal.create({
    data: {
      requestId: request.id,
      offerId: offer.id,
      clientId: client.id,
      executorId: executor.executor.id,
      title: opts.title ?? "Кухня",
      totalAmount: stages.reduce((s, x) => s + x.amount, 0),
      paymentMode: opts.paymentMode ?? "MANUAL",
      status: opts.status ?? "IN_PROGRESS",
      stageTemplate: "test",
      autoAcceptDays: 5,
      stages: {
        create: stages.map((s, i) => ({
          order: i + 1,
          title: `Этап ${i + 1}`,
          amount: s.amount,
          paymentDue: s.paymentDue ?? "ON_ACCEPTANCE",
          status: s.status ?? "PENDING",
          payment:
            s.amount > 0
              ? {
                  create: {
                    amount: s.amount,
                    status: s.payment ?? "DUE",
                    markedPaidAt: s.markedPaidDaysAgo === undefined ? null : new Date(Date.now() - s.markedPaidDaysAgo * 86_400_000),
                  },
                }
              : undefined,
        })),
      },
    },
    include: { stages: { orderBy: { order: "asc" } } },
  });
  // Сделка после подписей всегда имеет подписанный договор: от него строятся акты этапов.
  if (deal.status !== "AWAITING_SIGNATURES" && deal.status !== "CANCELLED") {
    const sha256 = "c".repeat(64);
    const file = await db.storedFile.create({
      data: { storageKey: `test/contract-${deal.id}.pdf`, provider: "local", purpose: "DOCUMENT", contentType: "application/pdf", size: 1, sha256 },
    });
    await db.document.create({
      data: { dealId: deal.id, kind: "CONTRACT", number: `Д-${deal.number}/2026`, fileId: file.id, sha256, status: "SIGNED", signedAt: new Date() },
    });
  }
  return { deal, client, executor };
}

export async function makeDispute(opts: { paymentMode?: PaymentMode } = {}) {
  const made = await makeDeal({ status: "DISPUTE", paymentMode: opts.paymentMode });
  const dispute = await db.dispute.create({
    data: {
      dealId: made.deal.id,
      stageId: made.deal.stages[0].id,
      openedById: made.client.id,
      reason: "QUALITY",
      description: "Фасады с царапинами",
      clientPosition: "Нужна замена фасадов",
      executorPosition: "Царапины появились при монтаже техники",
    },
  });
  return { ...made, dispute };
}
