import type { Prisma } from "@/generated/prisma/client";
import type { DealStatus } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { scopeHistory } from "@/modules/audit";
import { fileUrl } from "@/modules/files";
import type { CurrentUser } from "@/modules/identity";
import { LEDGER_INCLUDE, ledgerEntries, moneyFacts, toLedgerEntry, moneyHistoryOf, partyEstimate, projectMoney, type MoneyBlock, type MoneyFacts, type MoneyHistoryItem, type PartyEstimate } from "@/modules/payments";
import { db, type Db } from "@/platform/db";
import { env } from "@/platform/env";
import { fail } from "@/platform/errors";
import { isEnabled } from "@/platform/features";
import { logger } from "@/platform/logger";
import { nextStep, type NextStep } from "./next-step";
import { executorDisplayOf, executorDisplays } from "./ports";
import { plannedReadyAt } from "./schedule";
import { roleIn, scopeOf } from "./state";
import { checkTransition, DISPUTABLE, type DealContext } from "./transitions";

/**
 * Чтения для экранов /deals и /deals/[id] и данные для документов. Доступ (IDOR): покупатель — свои сделки,
 * мастер — свои, оператор — все; чужая сделка — «не найдено». Подпись мастера — companies.executorDisplay
 * («Исполнитель №N» или наименование в режиме «имя показано», ADR-006).
 */

type Party = "CLIENT" | "EXECUTOR";

function dealsWhere(user: CurrentUser): Prisma.DealWhereInput {
  if (user.role === "OPERATOR") return {};
  const asExecutor: Prisma.DealWhereInput[] = user.executor ? [{ executorId: user.executor.id }] : [];
  return { OR: [{ clientId: user.id }, ...asExecutor] };
}

/** Кем человек был в сделке — по самой сделке, а не по активной роли (самосделок нет). */
function partyOf(userId: string, deal: { clientId: string; executor: { userId: string } }): Party | null {
  if (deal.clientId === userId) return "CLIENT";
  return deal.executor.userId === userId ? "EXECUTOR" : null;
}

/** Сторона сделки в любой роли (для перехода на переключение роли). Чужая или несуществующая — null. */
export async function dealPartyOf(user: CurrentUser, dealId: string): Promise<Party | null> {
  const deal = await db.deal.findUnique({ where: { id: dealId }, select: { clientId: true, executor: { select: { userId: true } } } });
  return deal ? partyOf(user.id, deal) : null;
}

export type DealListItem = {
  id: string;
  number: number;
  title: string;
  status: DealStatus;
  isDemo: boolean;
  priceTiyn: bigint;
  /** Своя смета: покупателю — к оплате, мастеру — к выплате; оператору — к оплате. */
  estimate: PartyEstimate;
  money: MoneyBlock;
  executorLabel: string;
  updatedAt: Date;
  myRole: Party | null;
};

export async function listDeals(user: CurrentUser): Promise<DealListItem[]> {
  const deals = await db.deal.findMany({
    where: dealsWhere(user),
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: { executor: { select: { publicNumber: true, userId: true } }, transactions: { orderBy: { seq: "asc" }, include: LEDGER_INCLUDE } },
  });
  const shown = await executorDisplays(db, deals.map((d) => d.executorId));
  return deals.map((d) => {
    const myRole = user.role === "OPERATOR" ? null : partyOf(user.id, d);
    return {
      id: d.id,
      number: d.number,
      title: d.title,
      status: d.status,
      isDemo: d.isDemo,
      priceTiyn: d.priceTiyn,
      estimate: partyEstimate(myRole ?? "CLIENT", d.priceTiyn),
      money: projectMoney(d.transactions.map(toLedgerEntry), d),
      executorLabel: shown.get(d.executorId)?.label ?? ru.common.executorLabel(d.executor.publicNumber),
      updatedAt: d.updatedAt,
      myRole,
    };
  });
}

const viewInclude = {
  executor: { select: { publicNumber: true, userId: true } },
  request: {
    select: {
      style: true,
      details: true,
      city: true,
      furnitureType: { select: { slug: true } },
      photos: { where: { purpose: "REQUEST_ROOM" }, orderBy: { sortOrder: "asc" }, select: { id: true, provider: true, storageKey: true } },
    },
  },
  deliveryPhotos: { orderBy: { sortOrder: "asc" }, select: { id: true, provider: true, storageKey: true } },
  progressReports: { orderBy: { createdAt: "asc" }, include: { photos: { orderBy: { sortOrder: "asc" }, select: { id: true, provider: true, storageKey: true } } } },
  documents: { where: { status: { not: "SUPERSEDED" } }, orderBy: { version: "desc" }, include: { signatures: { select: { party: true } }, handSignatures: { select: { party: true } } } },
  disputes: { orderBy: { createdAt: "desc" }, take: 1 },
  review: true,
} as const satisfies Prisma.DealInclude;

type Loaded = Prisma.DealGetPayload<{ include: typeof viewInclude }>;

async function photoUrls(photos: { id: string; provider: string; storageKey: string }[]) {
  const out: { id: string; src: string }[] = [];
  for (const p of photos) {
    try {
      out.push({ id: p.id, src: await fileUrl(p) });
    } catch (error) {
      logger.warn("deal photo url failed", { fileId: p.id, error });
    }
  }
  return out;
}

function docView(deal: Loaded, kind: "CONTRACT" | "ACCEPTANCE_ACT") {
  const doc = deal.documents.find((d) => d.kind === kind);
  if (!doc) return null;
  const signedBy = [...new Set([...doc.signatures, ...doc.handSignatures].map((s) => s.party))];
  return { id: doc.id, number: doc.number, status: doc.status, version: doc.version, sha256: doc.sha256, signedBy };
}

async function loadView(user: CurrentUser, dealId: string): Promise<Loaded> {
  const deal = await db.deal.findUnique({ where: { id: dealId }, include: viewInclude });
  if (!deal || !roleIn(user, deal)) return fail.notFound(ru.deal.errors.notFound);
  return deal;
}

/** Покупатель отменяет после оплаты, пока деньги в банке и спора нет (возврат — по подтверждению банка). */
const canCancelAfterPay = (status: DealStatus, party: Party | null, ctx: DealContext) =>
  party === "CLIENT" && status === "PAID_HOLD" && !ctx.openDispute && !ctx.money.exitRequested;

/** Что из второстепенных действий доступно смотрящему сейчас (кнопки «Отменить», «Открыть спор», «Ход работ»). */
function availableActions(status: DealStatus, viewer: Party | "OPERATOR", ctx: DealContext) {
  const party = viewer === "OPERATOR" ? null : viewer;
  if (!party) return { cancel: false, openDispute: false, addProgress: false };
  return {
    cancel: checkTransition(status, "CANCELLED", party, ctx) === null || canCancelAfterPay(status, party, ctx),
    openDispute: DISPUTABLE.includes(status) && !ctx.openDispute && !ctx.money.exitRequested,
    addProgress: party === "EXECUTOR" && (status === "IN_PROGRESS" || status === "READY"),
  };
}

/** Контекст переходов для экрана — те же факты, что у сервиса (state.contextOf), без блокировки. */
function viewContext(deal: Loaded, facts: MoneyFacts): DealContext {
  const last = deal.disputes[0];
  return {
    signed: deal.signedAt !== null,
    actSigned: deal.documents.some((d) => d.kind === "ACCEPTANCE_ACT" && d.status === "SIGNED"),
    openDispute: last?.status === "OPEN",
    disputeOutcome: last?.status === "RESOLVED" ? last.outcome : null,
    money: facts,
  };
}

export async function getDealView(user: CurrentUser, dealId: string) {
  const deal = await loadView(user, dealId);
  const viewer = roleIn(user, deal) as Party | "OPERATOR";
  const entries = await ledgerEntries(db, deal.id);
  const facts = moneyFacts(entries);
  const lastDispute = deal.disputes[0] ?? null;
  const contract = docView(deal, "CONTRACT");
  const ctx = viewContext(deal, facts);
  const [history, shown] = await Promise.all([scopeHistory(scopeOf(deal.id)), executorDisplayOf(db, deal.executorId)]);
  const next: NextStep = nextStep({
    status: deal.status,
    viewer,
    signed: ctx.signed,
    contractSignedBy: contract ? contract.signedBy : [],
    hold: facts.hold,
    openDispute: ctx.openDispute,
    exitRequested: facts.exitRequested,
    canReview: isEnabled("reviews") && !deal.review,
  });
  return {
    id: deal.id,
    number: deal.number,
    /** Чат сделки привязан к отклику (ADR-003). */
    offerId: deal.offerId,
    title: deal.title,
    status: deal.status,
    isDemo: deal.isDemo,
    paymentProvider: deal.paymentProvider,
    viewer,
    /** Снимок денег по оферте; подписи строк — ru.payments.estimate[party]. */
    money: {
      priceTiyn: deal.priceTiyn,
      protectionTiyn: deal.protectionTiyn,
      buyerTotalTiyn: deal.buyerTotalTiyn,
      guaranteeTiyn: deal.guaranteeTiyn,
      payoutTiyn: deal.payoutTiyn,
      platformIncomeTiyn: deal.platformIncomeTiyn,
    },
    estimate: partyEstimate(viewer === "EXECUTOR" ? "EXECUTOR" : "CLIENT", deal.priceTiyn),
    /** Первый блок карточки — только из журнала. */
    moneyBlock: projectMoney(entries, deal),
    moneyHistory: moneyHistoryOf(entries) satisfies MoneyHistoryItem[],
    next,
    can: availableActions(deal.status, viewer, ctx),
    dates: {
      createdAt: deal.createdAt,
      signedAt: deal.signedAt,
      paidAt: deal.paidAt,
      startedAt: deal.startedAt,
      readyAt: deal.readyAt,
      acceptedAt: deal.acceptedAt,
      completedAt: deal.completedAt,
      cancelledAt: deal.cancelledAt,
      plannedReadyAt: plannedReadyAt(deal),
    },
    durationDays: deal.durationDays,
    warrantyMonths: deal.warrantyMonths,
    /** Что заказано — из заявки как есть: мебельных полей deal-core не толкует. */
    subject: {
      style: deal.request.style,
      details: deal.request.details as unknown,
      city: deal.request.city,
      typeSlug: deal.request.furnitureType?.slug ?? null,
      roomPhotos: await photoUrls(deal.request.photos),
    },
    executorLabel: shown.label,
    executorAddress: shown.address,
    contract,
    act: docView(deal, "ACCEPTANCE_ACT"),
    ready: deal.readyAt && {
      at: deal.readyAt,
      photos: await photoUrls(deal.deliveryPhotos),
      distanceM: deal.readyDistanceM,
      withinRadius: deal.readyWithinRadius,
      accuracyM: deal.readyAccuracyM,
      radiusM: env().READY_GPS_RADIUS_M,
    },
    progressReports: await Promise.all(
      deal.progressReports.map(async (r) => ({ id: r.id, title: r.title, text: r.text, createdAt: r.createdAt, photos: await photoUrls(r.photos) })),
    ),
    dispute: lastDispute && {
      id: lastDispute.id,
      status: lastDispute.status,
      reason: lastDispute.reason,
      description: lastDispute.description,
      clientPosition: lastDispute.clientPosition,
      executorPosition: lastDispute.executorPosition,
      outcome: lastDispute.outcome,
      masterShareTiyn: lastDispute.masterShareTiyn,
      rationale: lastDispute.rationale,
      createdAt: lastDispute.createdAt,
      resolvedAt: lastDispute.resolvedAt,
    },
    review: deal.review && { rating: deal.review.rating, text: deal.review.text, createdAt: deal.review.createdAt },
    history: history.map((h) => ({ id: h.id, action: h.action, actorRole: h.actorRole, createdAt: h.createdAt })),
  };
}

export type DealView = Awaited<ReturnType<typeof getDealView>>;

/**
 * documents → deal-core: данные для оферты, акта приёмки и выписки (в транзакции documents). Без проверки
 * доступа — её делает documents на своём входе. ИИН/БИН и IBAN не расшифровываются: только последние 4 цифры;
 * полные реквизиты для текста оферты documents читает сам по своим правилам.
 */
export async function dealDocumentData(client: Db, dealId: string) {
  const deal = await client.deal.findUnique({
    where: { id: dealId },
    include: {
      client: { select: { id: true, fullName: true, iinLast4: true } },
      executor: { select: { id: true, userId: true, publicNumber: true, legalForm: true, legalName: true, signerFullName: true, binIinLast4: true } },
      request: { select: { city: true, address: true, addressLat: true, addressLng: true } },
      deliveryPhotos: { orderBy: { sortOrder: "asc" }, select: { id: true, provider: true, storageKey: true, contentType: true } },
    },
  });
  if (!deal) return fail.notFound(ru.deal.errors.notFound);
  const entries = await ledgerEntries(client, dealId);
  return {
    deal: { id: deal.id, number: deal.number, title: deal.title, status: deal.status, isDemo: deal.isDemo, paymentProvider: deal.paymentProvider, durationDays: deal.durationDays, warrantyMonths: deal.warrantyMonths, createdAt: deal.createdAt, signedAt: deal.signedAt, readyAt: deal.readyAt, acceptedAt: deal.acceptedAt },
    money: { priceTiyn: deal.priceTiyn, protectionTiyn: deal.protectionTiyn, buyerTotalTiyn: deal.buyerTotalTiyn, guaranteeTiyn: deal.guaranteeTiyn, payoutTiyn: deal.payoutTiyn, platformIncomeTiyn: deal.platformIncomeTiyn },
    client: deal.client,
    executor: deal.executor,
    address: deal.request,
    ready: deal.readyAt
      ? { at: deal.readyAt, lat: deal.readyLat, lng: deal.readyLng, accuracyM: deal.readyAccuracyM, distanceM: deal.readyDistanceM, withinRadius: deal.readyWithinRadius, radiusM: env().READY_GPS_RADIUS_M, photos: deal.deliveryPhotos }
      : null,
    /** Для выписки (MONEY_STATEMENT): та же история денег, что на экране. */
    moneyHistory: moneyHistoryOf(entries),
    moneyBlock: projectMoney(entries, deal),
  };
}

export type DealDocumentData = Awaited<ReturnType<typeof dealDocumentData>>;
