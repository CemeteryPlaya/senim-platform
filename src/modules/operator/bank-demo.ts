import type { DealStatus } from "@/generated/prisma/enums";
import { scopeHistory } from "@/modules/audit";
import { db, Prisma } from "@/platform/db";
import { env, resolvePaymentProvider } from "@/platform/env";
import { assertDemoMode } from "./access";
import { toAuditView } from "./audit-view";
import { loadDealCard } from "./deals";
import { buildScenario, type Persona, type ScenarioSnapshot } from "./scenario";

/**
 * Страница показа банку (только DEMO_MODE, docs/bank/05-demo-script.md): одна сделка на провайдере manual —
 * шаги со ссылками на экраны под нужной персоной, журнал денег с банковскими документами, документы
 * с хэшами и подписями и журнал аудита сделки. Роль не проверяется: ведущий переключает персоны по ходу
 * показа, а в DEMO_MODE все данные тестовые.
 */

const personUser = { id: true, fullName: true, phone: true } satisfies Prisma.UserSelect;
type PersonUser = Prisma.UserGetPayload<{ select: typeof personUser }>;

/** role — роль шага, а не роль по умолчанию: у персоны с двумя ролями (ADR-004) вход сразу в нужной. */
function persona(user: PersonUser, role: Persona["role"], fallbackName = ""): Persona {
  return { userId: user.id, name: user.fullName ?? fallbackName, role, phone: user.phone };
}

const dealForStep = {
  id: true,
  number: true,
  paymentProvider: true,
  client: { select: personUser },
  executor: { select: { legalName: true, user: { select: personUser } } },
} satisfies Prisma.DealSelect;

/** Шаг показа — только с демо-персонами с обеих сторон: под другими войти из /demo нельзя. */
const DEMO_PARTIES = { client: { isDemo: true }, executor: { user: { isDemo: true } } } satisfies Prisma.DealWhereInput;

/** Показ идёт на manual: сделка с этим провайдером, если есть, иначе любая в нужном шаге. */
async function dealWhere(where: Prisma.DealWhereInput) {
  const deals = await db.deal.findMany({ where: { ...where, ...DEMO_PARTIES }, orderBy: { updatedAt: "desc" }, take: 20, select: dealForStep });
  return deals.find((d) => d.paymentProvider === "MANUAL") ?? deals[0];
}

type StepDeal = Awaited<ReturnType<typeof dealWhere>>;
const ref = (d: StepDeal) => d && { id: d.id, number: d.number };
const withClient = (d: StepDeal) => d && { id: d.id, number: d.number, client: persona(d.client, "CLIENT") };
const withExecutor = (d: StepDeal) => d && { id: d.id, number: d.number, executor: persona(d.executor.user, "EXECUTOR", d.executor.legalName) };
const inStatus = (status: DealStatus | DealStatus[]) => dealWhere({ status: Array.isArray(status) ? { in: status } : status });

async function snapshot(): Promise<ScenarioSnapshot> {
  const [operator, client, tenders, signing, payment, work, act, payout, completed] = await Promise.all([
    db.user.findFirst({ where: { isDemo: true, roles: { has: "OPERATOR" } }, orderBy: { phone: "asc" }, select: personUser }),
    db.user.findFirst({ where: { isDemo: true, role: "CLIENT" }, orderBy: { phone: "asc" }, select: personUser }),
    db.request.findMany({
      where: { status: "OPEN", mode: "TENDER", client: { isDemo: true } },
      select: { id: true, number: true, client: { select: personUser }, _count: { select: { offers: { where: { status: "SENT" } } } } },
    }),
    dealWhere({ status: "CREATED", signedAt: null }),
    dealWhere({ status: "CREATED", signedAt: { not: null } }),
    inStatus(["PAID_HOLD", "IN_PROGRESS"]),
    inStatus("READY"),
    inStatus("ACCEPTED"),
    inStatus("SPLIT_PAYOUT"),
  ]);
  const tender = tenders.sort((a, b) => b._count.offers - a._count.offers)[0];
  return {
    operator: operator ? persona(operator, "OPERATOR") : null,
    newRequest: client ? { client: persona(client, "CLIENT") } : undefined,
    tender: tender && { id: tender.id, number: tender.number, client: persona(tender.client, "CLIENT") },
    signing: withClient(signing),
    payment: ref(payment),
    work: withExecutor(work),
    act: withClient(act),
    payout: ref(payout),
    completed: withClient(completed),
  };
}

/** Сделка для разбора: заданная номером, иначе завершённая на manual, иначе завершённая, иначе последняя. */
async function pickDealId(number?: number): Promise<string | undefined> {
  if (number !== undefined) return (await db.deal.findUnique({ where: { number }, select: { id: true } }))?.id;
  const deals = await db.deal.findMany({ orderBy: { updatedAt: "desc" }, take: 200, select: { id: true, status: true, paymentProvider: true } });
  const done = deals.filter((d) => d.status === "SPLIT_PAYOUT");
  return (done.find((d) => d.paymentProvider === "MANUAL") ?? done[0] ?? deals[0])?.id;
}

export async function getBankDemo(input: { deal?: number }) {
  assertDemoMode();
  const [snap, deals, dealId] = await Promise.all([
    snapshot(),
    db.deal.findMany({ orderBy: { number: "desc" }, take: 200, select: { number: true, title: true, status: true } }),
    pickDealId(input.deal),
  ]);
  const selected = dealId
    ? { card: await loadDealCard(dealId), history: (await scopeHistory(`deal:${dealId}`)).map(toAuditView) }
    : null;
  return { newDealProvider: resolvePaymentProvider(env()), steps: buildScenario(snap), deals, selected };
}

export type BankDemo = Awaited<ReturnType<typeof getBankDemo>>;
