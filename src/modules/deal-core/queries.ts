import type { Prisma } from "@/generated/prisma/client";
import { ru } from "@/i18n/ru";
import { scopeHistory } from "@/modules/audit";
import { fileUrl } from "@/modules/files";
import type { CurrentUser } from "@/modules/identity";
import { db } from "@/platform/db";
import { fail } from "@/platform/errors";
import { logger } from "@/platform/logger";
import { nextStep, type NextStep } from "./next-step";
import { executorDisplayOf, executorDisplays } from "./ports";
import { retryableKeys } from "./retry-policy";
import { openEscrowAccount } from "./service";
import { roleIn, scopeOf } from "./state";

/**
 * Чтения для экранов /deals и /deals/[id]. Доступ: заказчик — свои сделки, исполнитель — свои,
 * оператор — все; чужая сделка — «не найдено». Подпись и адрес исполнителя — из companies.executorDisplay:
 * по умолчанию «Исполнитель №N», город и район; наименование — только в режиме «имя показано» (№6, ADR-006).
 * ИИН/БИН есть только в договоре, телефона нет нигде.
 */

type Party = "CLIENT" | "EXECUTOR";

/**
 * Список сделок: оператор — все; человек — свои в обеих ролях (ADR-004: история заказчика и исполнителя
 * на одном аккаунте), с пометкой роли. Открыть сделку другой роли — после переключения роли.
 */
function dealsWhere(user: CurrentUser): Prisma.DealWhereInput {
  if (user.role === "OPERATOR") return {};
  const asExecutor: Prisma.DealWhereInput[] = user.executor ? [{ executorId: user.executor.id }] : [];
  return { OR: [{ clientId: user.id }, ...asExecutor] };
}

/** Кем человек был в сделке — по самой сделке, а не по активной роли. Самосделок нет, роль одна. */
function partyOf(userId: string, deal: { clientId: string; executor: { userId: string } }): Party | null {
  if (deal.clientId === userId) return "CLIENT";
  return deal.executor.userId === userId ? "EXECUTOR" : null;
}

/**
 * Сторона сделки в любой роли (для перехода со страницы сделки на переключение роли).
 * Чужая или несуществующая — null.
 */
export async function dealPartyOf(user: CurrentUser, dealId: string): Promise<Party | null> {
  const deal = await db.deal.findUnique({ where: { id: dealId }, select: { clientId: true, executor: { select: { userId: true } } } });
  return deal ? partyOf(user.id, deal) : null;
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
  /** Кем человек был в этой сделке; у оператора — null. */
  myRole: Party | null;
};

export async function listDeals(user: CurrentUser): Promise<DealListItem[]> {
  const deals = await db.deal.findMany({
    where: dealsWhere(user),
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: { executor: { select: { publicNumber: true, userId: true } }, stages: { select: { status: true } } },
  });
  const shown = await executorDisplays(db, deals.map((d) => d.executorId));
  return deals.map((d) => ({
    id: d.id,
    number: d.number,
    title: d.title,
    status: d.status,
    totalAmount: d.totalAmount,
    executorLabel: shown.get(d.executorId)?.label ?? ru.common.executorLabel(d.executor.publicNumber),
    closedStages: d.stages.filter((s) => s.status === "CLOSED").length,
    totalStages: d.stages.length,
    updatedAt: d.updatedAt,
    myRole: user.role === "OPERATOR" ? null : partyOf(user.id, d),
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

/** Эскроу: счёт открывается задачей после подписи; если её ещё не было — открываем при показе. */
async function loadShown(user: CurrentUser, dealId: string): Promise<Loaded> {
  const deal = await loadView(user, dealId);
  if (deal.status !== "AWAITING_DEPOSIT" || deal.escrow) return deal;
  try {
    await openEscrowAccount(deal.id);
    return await loadView(user, dealId);
  } catch (error) {
    logger.warn("escrow account not ready", { dealId, error });
    return deal;
  }
}

/** Действующий документ (не заменённый новой версией). */
const currentDoc = (deal: Loaded, match: (d: Loaded["documents"][number]) => boolean) => {
  const doc = deal.documents.find((d) => match(d) && d.status !== "SUPERSEDED");
  return doc ? docView(doc) : null;
};

async function stageView(deal: Loaded, s: Loaded["stages"][number], now: Date) {
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
    // Срок показываем, только пока он впереди и сделка в работе: прошедший ждёт задачу, а не человека.
    autoAcceptAt: deal.status === "IN_PROGRESS" && s.autoAcceptAt && s.autoAcceptAt > now ? s.autoAcceptAt : null,
    acceptedAt: s.acceptedAt,
    acceptedAutomatically: s.acceptedBy === "system:auto-accept",
    payment: s.payment && { status: s.payment.status, amount: s.payment.amount, markedPaidAt: s.payment.markedPaidAt, confirmedAt: s.payment.confirmedAt },
    photos: await photoUrls(s.photos),
    act: currentDoc(deal, (d) => d.kind === "STAGE_ACT" && d.stageId === s.id),
  };
}

export async function getDealView(user: CurrentUser, dealId: string, now = new Date()) {
  const deal = await loadShown(user, dealId);
  const viewer = roleIn(user, deal) as Party | "OPERATOR";
  const contract = currentDoc(deal, (d) => d.kind === "CONTRACT");
  const stages = await Promise.all(deal.stages.map((s) => stageView(deal, s, now)));

  const dispute = deal.disputes[0] ?? null;
  // Ключ повтора нужен только оператору; правило — то же, что у сервиса повтора.
  const retryable = viewer === "OPERATOR" ? retryableKeys(deal.operations, { dealStatus: deal.status, stages: deal.stages, dispute }) : new Set<string>();
  const [history, shown] = await Promise.all([scopeHistory(scopeOf(deal.id)), executorDisplayOf(db, deal.executorId)]);
  const base = {
    id: deal.id,
    number: deal.number,
    /** Чат сделки привязан к отклику (ADR-003). */
    offerId: deal.offerId,
    title: deal.title,
    status: deal.status,
    paymentMode: deal.paymentMode,
    totalAmount: deal.totalAmount,
    createdAt: deal.createdAt,
    signedAt: deal.signedAt,
    viewer,
    executorLabel: shown.label,
    executorAddress: shown.address,
    contract,
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
    operations: deal.operations.map((o) => ({
      id: o.id,
      kind: o.kind,
      amount: o.amount,
      status: o.status,
      createdAt: o.createdAt,
      retryKey: retryable.has(o.idempotencyKey) ? o.idempotencyKey : null,
    })),
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
