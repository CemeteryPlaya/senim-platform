import type { Prisma } from "@/generated/prisma/client";
import { ru } from "@/i18n/ru";
import { scopeHistory } from "@/modules/audit";
import { fileUrl } from "@/modules/files";
import type { CurrentUser } from "@/modules/identity";
import { db } from "@/platform/db";
import { fail } from "@/platform/errors";
import { logger } from "@/platform/logger";
import { nextStep, type NextStep } from "./next-step";
import { openEscrowAccount } from "./service";
import { roleIn, scopeOf } from "./state";

/**
 * Чтения для экранов /deals и /deals/[id]. Доступ: заказчик — свои сделки, исполнитель — свои,
 * оператор — все; чужая сделка — «не найдено». Заказчик видит исполнителя только как «Исполнитель №N»:
 * наименование и ИИН/БИН есть только в договоре, телефона нет нигде.
 */

type Party = "CLIENT" | "EXECUTOR";

function dealsWhere(user: CurrentUser): Prisma.DealWhereInput | null {
  if (user.role === "OPERATOR") return {};
  if (user.role === "CLIENT") return { clientId: user.id };
  return user.executor ? { executorId: user.executor.id } : null;
}

export type DealListItem = {
  id: string;
  number: number;
  title: string;
  status: Prisma.DealGetPayload<object>["status"];
  totalAmount: number;
  executorLabel: string;
  closedStages: number;
  totalStages: number;
  updatedAt: Date;
};

export async function listDeals(user: CurrentUser): Promise<DealListItem[]> {
  const where = dealsWhere(user);
  if (!where) return [];
  const deals = await db.deal.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: { executor: { select: { publicNumber: true } }, stages: { select: { status: true } } },
  });
  return deals.map((d) => ({
    id: d.id,
    number: d.number,
    title: d.title,
    status: d.status,
    totalAmount: d.totalAmount,
    executorLabel: ru.common.executorLabel(d.executor.publicNumber),
    closedStages: d.stages.filter((s) => s.status === "CLOSED").length,
    totalStages: d.stages.length,
    updatedAt: d.updatedAt,
  }));
}

const viewInclude = {
  executor: { select: { publicNumber: true } },
  stages: {
    orderBy: { order: "asc" },
    include: { payment: true, photos: { orderBy: { sortOrder: "asc" }, select: { id: true, provider: true, storageKey: true } } },
  },
  documents: { orderBy: { version: "desc" }, include: { signatures: { select: { party: true } } } },
  disputes: { orderBy: { createdAt: "desc" }, take: 1 },
  review: true,
  escrow: true,
  operations: { orderBy: { createdAt: "asc" } },
} as const satisfies Prisma.DealInclude;

type Loaded = Prisma.DealGetPayload<{ include: typeof viewInclude }>;

const docView = (doc: Loaded["documents"][number]) => ({
  id: doc.id,
  number: doc.number,
  status: doc.status,
  sha256: doc.sha256,
  version: doc.version,
  signedBy: doc.signatures.map((s) => s.party as Party),
});

async function photoUrls(photos: { id: string; provider: string; storageKey: string }[]) {
  const out: { id: string; src: string }[] = [];
  for (const p of photos) {
    try {
      out.push({ id: p.id, src: await fileUrl(p) });
    } catch (error) {
      logger.warn("stage photo url failed", { fileId: p.id, error });
    }
  }
  return out;
}

export async function getDealView(user: CurrentUser, dealId: string) {
  let deal = await loadView(user, dealId);
  // Эскроу: счёт открывается задачей после подписи; если её ещё не было — открываем при показе.
  if (deal.status === "AWAITING_DEPOSIT" && !deal.escrow) {
    try {
      await openEscrowAccount(deal.id);
      deal = await loadView(user, dealId);
    } catch (error) {
      logger.warn("escrow account not ready", { dealId, error });
    }
  }
  const viewer = roleIn(user, deal) as Party | "OPERATOR";

  const contract = deal.documents.find((d) => d.kind === "CONTRACT" && d.status !== "SUPERSEDED") ?? null;
  const stages = await Promise.all(
    deal.stages.map(async (s) => {
      const act = deal.documents.find((d) => d.kind === "STAGE_ACT" && d.stageId === s.id && d.status !== "SUPERSEDED") ?? null;
      return {
        id: s.id,
        order: s.order,
        title: s.title,
        description: s.description,
        amount: s.amount,
        paymentDue: s.paymentDue,
        status: s.status,
        report: s.report,
        reworkNote: s.reworkNote,
        submittedAt: s.submittedAt,
        autoAcceptAt: s.autoAcceptAt,
        acceptedAt: s.acceptedAt,
        acceptedAutomatically: s.acceptedBy === "system:auto-accept",
        payment: s.payment ? { status: s.payment.status, amount: s.payment.amount, markedPaidAt: s.payment.markedPaidAt, confirmedAt: s.payment.confirmedAt } : null,
        photos: await photoUrls(s.photos),
        act: act ? docView(act) : null,
      };
    }),
  );

  const dispute = deal.disputes[0] ?? null;
  const history = await scopeHistory(scopeOf(deal.id));
  const base = {
    id: deal.id,
    number: deal.number,
    title: deal.title,
    status: deal.status,
    paymentMode: deal.paymentMode,
    totalAmount: deal.totalAmount,
    createdAt: deal.createdAt,
    signedAt: deal.signedAt,
    viewer,
    executorLabel: ru.common.executorLabel(deal.executor.publicNumber),
    contract: contract ? docView(contract) : null,
    stages,
    dispute: dispute && {
      id: dispute.id,
      status: dispute.status,
      reason: dispute.reason,
      description: dispute.description,
      clientPosition: dispute.clientPosition,
      executorPosition: dispute.executorPosition,
      decision: dispute.decision,
      decisionAmount: dispute.decisionAmount,
      rationale: dispute.rationale,
      createdAt: dispute.createdAt,
      resolvedAt: dispute.resolvedAt,
    },
    review: deal.review && { rating: deal.review.rating, text: deal.review.text, createdAt: deal.review.createdAt },
    escrow: deal.escrow && {
      accountId: deal.escrow.id,
      externalId: deal.escrow.externalId,
      status: deal.escrow.status,
      deposited: deal.escrow.deposited,
      released: deal.escrow.released,
      refunded: deal.escrow.refunded,
      requisites: deal.escrow.requisites as Record<string, string>,
    },
    operations: deal.operations.map((o) => ({ id: o.id, kind: o.kind, amount: o.amount, status: o.status, createdAt: o.createdAt })),
    history: history.map((e) => ({ id: e.id, action: e.action, actorRole: e.actorRole, createdAt: e.createdAt })),
  };
  const next: NextStep = nextStep({
    status: base.status,
    paymentMode: base.paymentMode,
    viewer,
    contract: base.contract,
    hasReview: !!base.review,
    escrowAccountId: base.escrow?.accountId ?? null,
    stages,
  });
  return { ...base, next };
}

export type DealView = Awaited<ReturnType<typeof getDealView>>;

async function loadView(user: CurrentUser, dealId: string): Promise<Loaded> {
  const deal = await db.deal.findUnique({ where: { id: dealId }, include: viewInclude });
  if (!deal || !roleIn(user, deal)) return fail.notFound(ru.deal.errors.notFound);
  return deal;
}
