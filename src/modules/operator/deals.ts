import type { DealStatus, MoneyTransactionStatus, MoneyTransactionType, PaymentProviderKind } from "@/generated/prisma/enums";
import type { CurrentUser } from "@/modules/identity";
import { moneyView, type MoneyBlock } from "@/modules/payments";
import { db, Prisma } from "@/platform/db";
import { fail } from "@/platform/errors";
import { assertOperator } from "./access";
import { isManualType, type ManualOperationType } from "./money";

/**
 * Сделки глазами оператора: блок денег и журнал денег (только чтение журнала), ждущие операции manual,
 * документы с хэшами и подписями и пакет для банка на раскрытие (ADR-009, docs/bank/03 раздел 4).
 */

export type OperatorDealRow = {
  id: string;
  number: number;
  title: string;
  status: DealStatus;
  provider: PaymentProviderKind;
  isDemo: boolean;
  disputeOpen: boolean;
  pendingOperations: number;
  createdAt: Date;
};

export async function listOperatorDeals(operator: CurrentUser): Promise<OperatorDealRow[]> {
  assertOperator(operator);
  const deals = await db.deal.findMany({
    orderBy: { number: "desc" },
    take: 200,
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
      paymentProvider: true,
      isDemo: true,
      createdAt: true,
      _count: { select: { disputes: { where: { status: "OPEN" } }, transactions: { where: { status: "PENDING", provider: "MANUAL" } } } },
    },
  });
  return deals.map((d) => ({
    id: d.id,
    number: d.number,
    title: d.title,
    status: d.status,
    provider: d.paymentProvider,
    isDemo: d.isDemo,
    disputeOpen: d._count.disputes > 0,
    pendingOperations: d._count.transactions,
    createdAt: d.createdAt,
  }));
}

const signatureSelect = {
  signatures: { orderBy: { signedAt: "asc" }, select: { party: true, method: true, signedSha256: true, certSubject: true, verified: true, signedAt: true } },
  handSignatures: { orderBy: { signedAt: "asc" }, select: { party: true, typedName: true, imageFileId: true, documentSha256: true, ip: true, signedAt: true } },
} satisfies Prisma.DocumentSelect;

const documentSelect = {
  id: true,
  kind: true,
  number: true,
  version: true,
  sha256: true,
  status: true,
  createdAt: true,
  signedAt: true,
  ...signatureSelect,
} satisfies Prisma.DocumentSelect;

export type DealDocument = Prisma.DocumentGetPayload<{ select: typeof documentSelect }>;

/** Строка журнала денег для оператора: с реквизитами банковского документа. seq — строка (в клиент). */
export type JournalRow = {
  id: string;
  seq: string;
  type: MoneyTransactionType;
  status: MoneyTransactionStatus;
  amountTiyn: bigint;
  idempotencyKey: string;
  parentId: string | null;
  isTest: boolean;
  externalRef: string | null;
  bankDocNumber: string | null;
  bankDocDate: Date | null;
  error: string | null;
  createdAt: Date;
  settledAt: Date | null;
};

/** Пакет на раскрытие: акт с подписями, расписка (если сформирована documents) и суммы раздела из журнала. */
export type ReleasePackage = {
  act: DealDocument | null;
  receipt: DealDocument | null;
  releaseTiyn: bigint;
  masterTiyn: bigint;
  platformTiyn: bigint;
  /** Раскрытие уже подтверждено банком или все части выплачены — пакет нужен только для истории. */
  done: boolean;
};

export type OperatorDeal = {
  deal: {
    id: string;
    number: number;
    title: string;
    status: DealStatus;
    provider: PaymentProviderKind;
    isDemo: boolean;
    priceTiyn: bigint;
    buyerTotalTiyn: bigint;
    payoutTiyn: bigint;
    platformIncomeTiyn: bigint;
    signedAt: Date | null;
    clientName: string | null;
    executorNumber: number;
    executorName: string;
  };
  money: MoneyBlock;
  journal: JournalRow[];
  pending: { id: string; type: ManualOperationType; amountTiyn: bigint; createdAt: Date }[];
  documents: DealDocument[];
  openDisputeId: string | null;
  releasePackage: ReleasePackage | null;
};

const latest = (docs: DealDocument[], kind: DealDocument["kind"]) => docs.filter((d) => d.kind === kind && d.status !== "SUPERSEDED").at(-1) ?? null;

/** Пакет показывается, когда есть распоряжение о раскрытии (RELEASE); пока открыт спор, его нет (FREEZE). */
function releasePackageOf(journal: JournalRow[], docs: DealDocument[]): ReleasePackage | null {
  const release = journal.filter((r) => r.type === "RELEASE" && r.status !== "FAILED").at(-1);
  if (!release) return null;
  const parts = journal.filter((r) => r.parentId === release.id && r.status !== "FAILED");
  const sumOf = (type: JournalRow["type"]) => parts.filter((p) => p.type === type).reduce((a, p) => a + p.amountTiyn, 0n);
  return {
    act: latest(docs, "ACCEPTANCE_ACT"),
    receipt: latest(docs, "RELEASE_RECEIPT"),
    releaseTiyn: release.amountTiyn,
    masterTiyn: sumOf("SPLIT_MASTER"),
    platformTiyn: sumOf("SPLIT_PLATFORM"),
    done: release.status === "SUCCEEDED" && parts.every((p) => p.status === "SUCCEEDED"),
  };
}

export async function getOperatorDeal(operator: CurrentUser, dealId: string): Promise<OperatorDeal> {
  assertOperator(operator);
  return loadDealCard(dealId);
}

/** Карточка без проверки роли — для страницы показа банку (только DEMO_MODE, проверяет вызывающий). */
export async function loadDealCard(dealId: string): Promise<OperatorDeal> {
  const deal = await db.deal.findUnique({
    where: { id: dealId },
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
      paymentProvider: true,
      isDemo: true,
      priceTiyn: true,
      buyerTotalTiyn: true,
      payoutTiyn: true,
      platformIncomeTiyn: true,
      signedAt: true,
      client: { select: { fullName: true } },
      executor: { select: { publicNumber: true, legalName: true } },
      documents: { orderBy: [{ createdAt: "asc" }, { version: "asc" }], select: documentSelect },
      disputes: { where: { status: "OPEN" }, select: { id: true } },
      transactions: { orderBy: { seq: "asc" } },
    },
  });
  if (!deal) return fail.notFound();
  const journal: JournalRow[] = deal.transactions.map((m) => ({
    id: m.id,
    seq: m.seq.toString(),
    type: m.type,
    status: m.status,
    amountTiyn: m.amountTiyn,
    idempotencyKey: m.idempotencyKey,
    parentId: m.parentId,
    isTest: m.isTest,
    externalRef: m.externalRef,
    bankDocNumber: m.bankDocNumber,
    bankDocDate: m.bankDocDate,
    error: m.error,
    createdAt: m.createdAt,
    settledAt: m.settledAt,
  }));
  const pending = deal.transactions.flatMap(({ id, type, provider, status, amountTiyn, createdAt }) =>
    provider === "MANUAL" && status === "PENDING" && isManualType(type) ? [{ id, type, amountTiyn, createdAt }] : [],
  );
  return {
    deal: {
      id: deal.id,
      number: deal.number,
      title: deal.title,
      status: deal.status,
      provider: deal.paymentProvider,
      isDemo: deal.isDemo,
      priceTiyn: deal.priceTiyn,
      buyerTotalTiyn: deal.buyerTotalTiyn,
      payoutTiyn: deal.payoutTiyn,
      platformIncomeTiyn: deal.platformIncomeTiyn,
      signedAt: deal.signedAt,
      clientName: deal.client.fullName,
      executorNumber: deal.executor.publicNumber,
      executorName: deal.executor.legalName,
    },
    money: await moneyView(deal.id),
    journal,
    pending,
    documents: deal.documents,
    openDisputeId: deal.disputes[0]?.id ?? null,
    releasePackage: releasePackageOf(journal, deal.documents),
  };
}
