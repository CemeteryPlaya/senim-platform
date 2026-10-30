import type { PaymentMode } from "@/generated/prisma/enums";
import { scopeHistory } from "@/modules/audit";
import { railFor, type RailMode, type StatementEntry } from "@/modules/payments";
import { db, Prisma } from "@/platform/db";
import { isAppError } from "@/platform/errors";
import { assertDemoMode } from "./access";
import { toAuditView } from "./audit-view";
import { getPaymentRailSetting } from "./demo";
import { buildScenario, type Persona, type ScenarioSnapshot } from "./scenario";

/**
 * Страница показа банку (только DEMO_MODE): сценарий полного цикла по демо-данным,
 * журнал выбранной сделки, документы с хэшами и подписями, счёт и выписка симулятора.
 * Роль не проверяется: ведущий переключает персоны по ходу показа, а в DEMO_MODE все данные тестовые.
 */

const RAIL_OF: Record<PaymentMode, RailMode> = { MANUAL: "manual", ESCROW_SIMULATOR: "escrow-simulator", BANK: "bank" };

const personUser = { fullName: true, phone: true, role: true } satisfies Prisma.UserSelect;
type PersonUser = Prisma.UserGetPayload<{ select: typeof personUser }>;

function persona(user: PersonUser, fallbackName = ""): Persona {
  return { name: user.fullName ?? fallbackName, role: user.role, phone: user.phone };
}

const dealForStep = {
  id: true,
  number: true,
  paymentMode: true,
  client: { select: personUser },
  executor: { select: { legalName: true, user: { select: personUser } } },
} satisfies Prisma.DealSelect;

/** В эскроу-режиме показываем эскроу-сделку, если она есть: ради неё и показ. */
async function dealIn(status: "AWAITING_SIGNATURES" | "AWAITING_DEPOSIT" | "IN_PROGRESS" | "COMPLETED") {
  const deals = await db.deal.findMany({ where: { status }, orderBy: { updatedAt: "desc" }, select: dealForStep });
  return deals.find((d) => d.paymentMode !== "MANUAL") ?? deals[0];
}

async function snapshot(): Promise<ScenarioSnapshot> {
  const [rail, client, tenders, measurement, signing, deposit, inProgress, completed] = await Promise.all([
    getPaymentRailSetting(),
    db.user.findFirst({ where: { isDemo: true, role: "CLIENT" }, orderBy: { phone: "asc" }, select: personUser }),
    db.request.findMany({
      where: { status: "OPEN", mode: "TENDER" },
      select: { id: true, number: true, client: { select: personUser }, _count: { select: { offers: { where: { status: "SENT" } } } } },
    }),
    db.measurement.findFirst({
      where: { status: "SCHEDULED" },
      orderBy: { scheduledAt: "asc" },
      select: { request: { select: { id: true, number: true } }, offer: { select: { executor: { select: { legalName: true, user: { select: personUser } } } } } },
    }),
    dealIn("AWAITING_SIGNATURES"),
    dealIn("AWAITING_DEPOSIT"),
    dealIn("IN_PROGRESS"),
    dealIn("COMPLETED"),
  ]);
  const tender = tenders.sort((a, b) => b._count.offers - a._count.offers)[0];
  const withClient = (d: typeof signing) => d && { id: d.id, number: d.number, client: persona(d.client) };
  const withExecutor = (d: typeof signing) => d && { id: d.id, number: d.number, executor: persona(d.executor.user, d.executor.legalName) };

  return {
    railMode: rail.mode,
    newRequest: client ? { client: persona(client) } : undefined,
    tender: tender && { id: tender.id, number: tender.number, offers: tender._count.offers, client: persona(tender.client) },
    measuring: measurement && {
      id: measurement.request.id,
      number: measurement.request.number,
      executor: persona(measurement.offer.executor.user, measurement.offer.executor.legalName),
    },
    signing: withClient(signing),
    deposit: withClient(deposit),
    inProgress: withExecutor(inProgress),
    completed: withClient(completed),
  };
}

/** Сделка для журнала: заданная номером, иначе свежая эскроу-сделка, иначе завершённая, иначе последняя. */
async function pickDealId(number?: number): Promise<string | undefined> {
  if (number !== undefined) return (await db.deal.findUnique({ where: { number }, select: { id: true } }))?.id;
  const deals = await db.deal.findMany({ orderBy: { updatedAt: "desc" }, select: { id: true, status: true, paymentMode: true } });
  return (deals.find((d) => d.paymentMode === "ESCROW_SIMULATOR") ?? deals.find((d) => d.status === "COMPLETED") ?? deals[0])?.id;
}

async function statementOrNull(mode: PaymentMode, externalId: string): Promise<StatementEntry[] | null> {
  try {
    return await railFor(RAIL_OF[mode]).getStatement(externalId);
  } catch (e) {
    if (isAppError(e)) return null; // рельс ещё не подключён — экран говорит «выписка недоступна»
    throw e;
  }
}

async function dealDetails(dealId: string) {
  const deal = await db.deal.findUniqueOrThrow({
    where: { id: dealId },
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
      paymentMode: true,
      totalAmount: true,
      createdAt: true,
      stages: { orderBy: { order: "asc" }, select: { id: true, order: true, title: true, amount: true, status: true, payment: { select: { status: true } } } },
      documents: {
        orderBy: [{ createdAt: "asc" }],
        select: {
          id: true,
          kind: true,
          number: true,
          version: true,
          sha256: true,
          status: true,
          createdAt: true,
          signedAt: true,
          signatures: {
            orderBy: { signedAt: "asc" },
            select: { party: true, method: true, signedSha256: true, certSubject: true, verified: true, signedAt: true },
          },
        },
      },
      escrow: { select: { rail: true, externalId: true, status: true, deposited: true, released: true, refunded: true } },
      operations: {
        orderBy: { createdAt: "asc" },
        select: { id: true, kind: true, amount: true, status: true, idempotencyKey: true, externalRef: true, createdAt: true, completedAt: true },
      },
    },
  });
  const { documents, escrow, operations, ...rest } = deal;
  return {
    deal: rest,
    history: (await scopeHistory(`deal:${dealId}`)).map(toAuditView),
    documents,
    escrow,
    operations,
    statement: escrow ? await statementOrNull(escrow.rail, escrow.externalId) : null,
  };
}

export async function getBankDemo(input: { deal?: number }) {
  assertDemoMode();
  const [snap, deals, dealId, rail] = await Promise.all([
    snapshot(),
    db.deal.findMany({ orderBy: { number: "desc" }, select: { number: true, title: true, status: true, paymentMode: true } }),
    pickDealId(input.deal),
    getPaymentRailSetting(),
  ]);
  return { rail, steps: buildScenario(snap), deals, selected: dealId ? await dealDetails(dealId) : null };
}

export type BankDemo = Awaited<ReturnType<typeof getBankDemo>>;
