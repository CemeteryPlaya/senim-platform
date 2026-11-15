import type { FilePurpose, Role } from "@/generated/prisma/enums";
import { addProgressReport, cancelDeal, onMoneySettled, openDispute, payForDeal, resolveDispute, startWork, submitDisputePosition, submitReady } from "@/modules/deal-core";
import { completeSigning, signByHand, startSigning } from "@/modules/documents";
import { saveFile, storageByName } from "@/modules/files";
import { consentDocument, consentTextSha256, seedIdentityBankConsents, type CurrentUser } from "@/modules/identity";
import { confirmManualOperation, kztToTiyn } from "@/modules/payments";
import { acceptPrice } from "@/modules/requests";
import { db } from "@/platform/db";
import { formatTiyn } from "@/ui/format";
import { DEALS, REVIEWS, type ClientKey, type DealPlan, type DealStep, type ExecutorKey } from "./data";
import { demoFile, type DemoFileKey } from "./portfolio-files";
import type { SeedReview, SeedWindow } from "./retime";
import { resolveWhen } from "./timeline";
import { testDocumentPdf } from "./test-documents";

/**
 * Сделки демо — путь ТЗ настоящими сервисами, от имени тех, кто нажимает кнопку в приложении:
 * акцепт цены торга (requests.acceptPrice → deal-core.createDeal, оферта PDF через порт documents),
 * подписи сторон (documents: собственноручно напечатанным именем и ЭЦП mock), оплата (payments: mock подтверждает
 * сразу, manual ждёт оператора), сдача с фото и GPS, акт, споры, отмены. На manual оператор подтверждает
 * операции банковским документом — тестовым сканом «ТЕСТОВЫЙ ДОКУМЕНТ». Деньги — только журнал payments.
 * Оплата проверяет согласия обеих сторон на передачу банку, как у всех: сид без сессий сторон заводит их в identity
 * (SeedConsents, канал seed) после создания сделок и до оплаты.
 */

/** Что сид «до сделок» (seed.ts) передаёт сюда: id людей и заявок с откликами по порядку спецификации. */
export type DealIds = {
  operator: string;
  clients: Map<ClientKey, string>;
  executors: Map<ExecutorKey, { userId: string; profileId: string }>;
  requests: Map<string, { id: string; offers: string[] }>;
};

/** Пользователь сессии — как его собирает identity.getCurrentUser (сид — доверенный скрипт, входа нет). */
async function asUser(userId: string, role: Role): Promise<CurrentUser> {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { executorProfile: { select: { id: true, publicNumber: true, status: true } } } });
  return { id: u.id, role, roles: u.roles, phone: u.phone, fullName: u.fullName, iinLast4: u.iinLast4, emailVerified: u.emailVerifiedAt !== null, isDemo: u.isDemo, executor: u.executorProfile, mfa: { required: role === "OPERATOR", verifiedAt: role === "OPERATOR" ? new Date() : null }, consents: [], consentRevocationOpen: false };
}

/**
 * Фото «с объекта» для сдачи и «Хода работ»: байты временного снимка из public/stand-photos загружаются через files
 * (saveFile → обычное хранилище), как загрузка мастера. Это приватные файлы сделки: их отдаёт только подписанная
 * ссылка, а не публичный адрес /stand-photos/… — static остаётся только у публичного портфолио.
 * Байты читает провайдер static (public/ рядом с сервером: dev и образ стенда).
 */
async function photo(source: DemoFileKey, purpose: FilePurpose, uploadedById: string): Promise<string> {
  const { storageKey } = demoFile(source);
  const bytes = await (await storageByName("static")).get(storageKey);
  if (!bytes) throw new Error(`Сид: нет файла public/${storageKey}`);
  return (await saveFile({ purpose, bytes, uploadedById })).id;
}

type Parties = { dealId: string; client: CurrentUser; executor: CurrentUser; operator: CurrentUser; address: { lat: number; lng: number } };

async function latestDoc(dealId: string, kind: "CONTRACT" | "ACCEPTANCE_ACT") {
  return db.document.findFirstOrThrow({ where: { dealId, kind, status: { not: "SUPERSEDED" } }, orderBy: { version: "desc" } });
}

/** Подписи стороны по таблице требуемых подписей (deal-core.requiredSignatures): собственноручная — если нужна, ЭЦП. */
async function signAs(user: CurrentUser, documentId: string, hand: boolean) {
  if (hand) await signByHand(user, { documentId, typedName: user.fullName ?? "Подписант" });
  const session = await startSigning(user, documentId, "EGOV_QR");
  await completeSigning(user, { documentId, sessionId: session.sessionId });
}

let scans = 0;

/** manual: оператор подтверждает все ждущие операции сделки по порядку журнала — номер, дата и тестовый скан. */
async function confirmBank(p: Parties) {
  for (;;) {
    const op = await db.moneyTransaction.findFirst({ where: { dealId: p.dealId, status: "PENDING" }, orderBy: { seq: "asc" } });
    if (!op) return;
    scans++;
    const number = `ТЕСТ-${String(scans).padStart(4, "0")}`;
    const date = new Date();
    const pdf = await testDocumentPdf(`Банковский документ ${number}`, [`Операция: ${op.type}`, `Сумма: ${formatTiyn(op.amountTiyn)}`, "Не является банковским документом: демо-данные."], date);
    const scan = await saveFile({ purpose: "BANK_DOCUMENT", bytes: pdf, uploadedById: p.operator.id });
    await confirmManualOperation(p.operator, { transactionId: op.id, bankDocNumber: number, bankDocDate: date, bankDocFileId: scan.id }, onMoneySettled);
  }
}

/** Место сдачи: у адреса заказа (в пределах радиуса) или примерно в 2 км от него. */
const readyPoint = (address: Parties["address"], at: "address" | "far") =>
  at === "address" ? { lat: address.lat + 0.0003, lng: address.lng + 0.0002, accuracyM: 15 } : { lat: address.lat + 0.018, lng: address.lng + 0.004, accuracyM: 25 };

async function step(p: Parties, s: DealStep): Promise<void> {
  if (s === "sign") {
    const contract = await latestDoc(p.dealId, "CONTRACT");
    await signAs(p.client, contract.id, true);
    await signAs(p.executor, contract.id, true);
    return;
  }
  if (s === "pay") return void (await payForDeal(p.client, { dealId: p.dealId }));
  if (s === "bank") return confirmBank(p);
  if (s === "start") return startWork(p.executor, { dealId: p.dealId });
  if (s === "signAct" || s === "signActClient") {
    const act = await latestDoc(p.dealId, "ACCEPTANCE_ACT");
    await signAs(p.client, act.id, true);
    if (s === "signAct") await signAs(p.executor, act.id, false);
    return;
  }
  if ("progress" in s) {
    const photoIds = await Promise.all(s.progress.photos.map((f) => photo(f, "PROGRESS_REPORT", p.executor.id)));
    return void (await addProgressReport(p.executor, { dealId: p.dealId, title: s.progress.title, text: s.progress.text, photoIds }));
  }
  if ("ready" in s) {
    const photoIds = await Promise.all(s.ready.photos.map((f) => photo(f, "DELIVERY", p.executor.id)));
    return void (await submitReady(p.executor, { dealId: p.dealId, photoIds, ...readyPoint(p.address, s.ready.at) }));
  }
  if ("cancel" in s) return void (await cancelDeal(s.cancel === "client" ? p.client : p.executor, { dealId: p.dealId, reason: s.reason }));
  if ("dispute" in s) {
    const d = s.dispute;
    const { disputeId } = await openDispute(d.by === "client" ? p.client : p.executor, { dealId: p.dealId, reason: d.reason, description: d.description });
    await submitDisputePosition(p.client, { disputeId, position: d.clientPosition });
    await submitDisputePosition(p.executor, { disputeId, position: d.executorPosition });
    return;
  }
  const dispute = await db.dispute.findFirstOrThrow({ where: { dealId: p.dealId, status: "OPEN" } });
  const r = s.resolve;
  await resolveDispute(p.operator, {
    disputeId: dispute.id,
    outcome: r.outcome,
    rationale: r.rationale,
    ...(r.outcome === "PARTIAL_SPLIT" && { masterShareTiyn: kztToTiyn(r.masterShareKzt) }),
  });
}

/** Сторона, чья цена ждёт ответа, — не она; принимает другая (как в экране торга). */
async function accept(ids: DealIds, plan: DealPlan) {
  const request = ids.requests.get(plan.request);
  if (!request) throw new Error(`Сделка демо: нет заявки ${plan.request}`);
  const offer = await db.offer.findUniqueOrThrow({
    where: { id: request.offers[0]! },
    include: { request: { select: { clientId: true, addressLat: true, addressLng: true } }, executor: { select: { userId: true } }, proposals: { where: { status: "PROPOSED" } } },
  });
  const open = offer.proposals[0];
  if (!open || offer.request.addressLat === null || offer.request.addressLng === null) throw new Error(`Сделка демо ${plan.request}: нет открытой цены или адреса`);
  const client = await asUser(offer.request.clientId, "CLIENT");
  const executor = await asUser(offer.executor.userId, "EXECUTOR");
  const { dealId } = await acceptPrice(open.party === "EXECUTOR" ? client : executor, { proposalId: open.id });
  // Провайдер фиксируется в сделке при создании (из PAYMENT_PROVIDER); демо показывает оба — до первой операции журнала.
  // Все сделки сида — тестовые (isDemo), и у покупателей вне демо-входа: их деньги не настоящие (операции isTest).
  await db.deal.update({ where: { id: dealId }, data: { paymentProvider: plan.provider === "manual" ? "MANUAL" : "MOCK", isDemo: true } });
  return { dealId, client, executor, address: { lat: offer.request.addressLat, lng: offer.request.addressLng } };
}

/** Согласия сторон на передачу банку-партнёру — у сделок, которые сид оплачивает: текущая редакция текста, как на экране сделки. */
async function seedBankConsents(deals: { plan: DealPlan; parties: Parties }[]) {
  const proof = { version: consentDocument("BANK_TRANSFER").version, textSha256: consentTextSha256("BANK_TRANSFER") };
  await seedIdentityBankConsents(
    deals
      .filter((d) => d.plan.steps.includes("pay"))
      .flatMap(({ parties }) => [parties.client.id, parties.executor.id].map((userId) => ({ ...proof, userId, dealId: parties.dealId }))),
  );
}

/** Что сделки отдают переносу времени (retime.ts): окна действий, конец засева, отзывы с id сделок. */
export type SeededDeals = { deals: number; windows: SeedWindow[]; end: number; reviews: SeedReview[] };

/**
 * Сделки по плану: каждое действие — своё окно стенных часов, его записи потом переносятся на день из `plan.at`
 * (`now` — часы сида, от них же считаются даты «до сделок»).
 */
export async function seedDeals(ids: DealIds, now: number): Promise<SeededDeals> {
  const operator = await asUser(ids.operator, "OPERATOR");
  const windows: SeedWindow[] = [];
  const mark = (when: DealPlan["at"]["accepted"]) => windows.push({ from: Date.now(), target: resolveWhen(when, now) });
  const deals: { plan: DealPlan; parties: Parties }[] = [];
  for (const plan of DEALS) {
    if (plan.at.steps.length !== plan.steps.length) throw new Error(`Сделка демо ${plan.request}: время задано не для каждого шага`);
    mark(plan.at.accepted);
    deals.push({ plan, parties: { ...(await accept(ids, plan)), operator } });
  }
  await seedBankConsents(deals);
  for (const { plan, parties } of deals) {
    for (const [i, s] of plan.steps.entries()) {
      mark(plan.at.steps[i]!);
      await step(parties, s);
    }
  }
  const dealOf = new Map(deals.map((d) => [d.plan.request, d.parties.dealId]));
  const reviews = REVIEWS.map((r) => {
    const dealId = dealOf.get(r.request);
    if (!dealId) throw new Error(`Отзыв демо: нет сделки по заявке ${r.request}`);
    return { ...r, dealId };
  });
  return { deals: DEALS.length, windows, end: Date.now(), reviews };
}
