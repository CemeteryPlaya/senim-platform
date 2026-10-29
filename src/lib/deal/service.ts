import "server-only";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/session";
import type { Prisma } from "@/generated/prisma/client";
import type { DealStatus, DisputeResolution, Party } from "@/generated/prisma/enums";
import { defaultStages, split, trancheFor } from "@/lib/deal/money";
import { mockEscrowProvider as escrowProvider } from "@/lib/providers/escrow";
import { hashDocument, mockSignatureProvider as signatureProvider, type SignMethod } from "@/lib/providers/signature";
import { contractFingerprint } from "@/lib/contract";
import { dealNo, tenge, shortDate } from "@/lib/format";

type Tx = Prisma.TransactionClient;

export class DealError extends Error {}

function fail(message: string): never {
  throw new DealError(message);
}

function partyOf(user: CurrentUser, deal: { clientId: string; masterId: string }): Party {
  if (deal.clientId === user.id) return "CLIENT";
  if (deal.masterId === user.id) return "MASTER";
  fail("Вы не участник этой сделки");
}

function expectStatus(deal: { status: DealStatus }, ...allowed: DealStatus[]) {
  if (!allowed.includes(deal.status)) fail("Действие недоступно на текущем этапе сделки");
}

async function log(tx: Tx, dealId: string, text: string, opts: { actorId?: string; icon?: string; image?: string } = {}) {
  await tx.dealEvent.create({ data: { dealId, kind: "SYSTEM", text, ...opts } });
}

async function loadDeal(tx: Tx, dealId: string) {
  const deal = await tx.deal.findUnique({
    where: { id: dealId },
    include: { stages: { orderBy: { order: "asc" } }, escrow: true, client: true, master: { include: { master: true } } },
  });
  if (!deal) fail("Сделка не найдена");
  return deal;
}

// ─── Согласование условий ────────────────────────────────────────────────────

export type NewDealInput = {
  masterId: string;
  title: string;
  furnitureType: string;
  description: string;
  dimensions: string;
  materials: string;
  color: string;
  address: string;
  amount: number;
  deadline: Date;
  advancePercent: number;
};

export async function createDeal(user: CurrentUser, input: NewDealInput) {
  if (user.role !== "CLIENT") fail("Сделку создаёт заказчик");
  if (input.amount < 10_000) fail("Минимальная сумма сделки — 10 000 ₸");
  const master = await db.user.findUnique({ where: { id: input.masterId } });
  if (!master || master.role !== "MASTER") fail("Исполнитель не найден");

  return db.$transaction(async (tx) => {
    const deal = await tx.deal.create({
      data: {
        title: input.title,
        furnitureType: input.furnitureType,
        description: input.description,
        specs: { dimensions: input.dimensions, materials: input.materials, color: input.color },
        address: input.address,
        amount: input.amount,
        deadline: input.deadline,
        status: "PROPOSED",
        awaitingParty: "MASTER",
        clientId: user.id,
        masterId: master.id,
        stages: {
          create: defaultStages(input.advancePercent).map((s, i) => ({ ...s, order: i + 1 })),
        },
      },
    });
    await log(tx, deal.id, `${user.name} предлагает сделку на ${tenge(input.amount)}, срок — до ${shortDate(input.deadline)}`, {
      actorId: user.id,
      icon: "file",
    });
    return deal;
  });
}

export async function acceptTerms(user: CurrentUser, dealId: string) {
  return db.$transaction(async (tx) => {
    const deal = await loadDeal(tx, dealId);
    expectStatus(deal, "PROPOSED");
    const party = partyOf(user, deal);
    if (deal.awaitingParty !== party) fail("Сейчас ход другой стороны");

    const contractNo = `${dealNo(deal.number)}/${new Date().getFullYear()}`;
    await tx.deal.update({ where: { id: deal.id }, data: { status: "AWAITING_SIGNATURES", awaitingParty: null, contractNo } });
    await log(tx, deal.id, `${user.name} принял(а) условия. Сформирован договор подряда № ${contractNo}`, {
      actorId: user.id,
      icon: "check",
    });
  });
}

export async function counterOffer(
  user: CurrentUser,
  dealId: string,
  input: { amount: number; deadline: Date; advancePercent: number; comment: string },
) {
  return db.$transaction(async (tx) => {
    const deal = await loadDeal(tx, dealId);
    expectStatus(deal, "PROPOSED");
    const party = partyOf(user, deal);
    if (deal.awaitingParty !== party) fail("Сейчас ход другой стороны");

    const changes: string[] = [];
    if (input.amount !== deal.amount) changes.push(`сумма ${tenge(deal.amount)} → ${tenge(input.amount)}`);
    if (shortDate(input.deadline) !== shortDate(deal.deadline))
      changes.push(`срок ${shortDate(deal.deadline)} → ${shortDate(input.deadline)}`);
    const advance = deal.stages.find((s) => s.order === 2);
    if (advance && advance.payoutPercent !== input.advancePercent)
      changes.push(`аванс на материалы ${advance.payoutPercent}% → ${input.advancePercent}%`);
    if (changes.length === 0 && !input.comment) fail("Укажите, что хотите изменить");

    await tx.deal.update({
      where: { id: deal.id },
      data: {
        amount: input.amount,
        deadline: input.deadline,
        revision: { increment: 1 },
        awaitingParty: party === "CLIENT" ? "MASTER" : "CLIENT",
      },
    });
    const percents = defaultStages(input.advancePercent);
    for (const stage of deal.stages) {
      await tx.stage.update({ where: { id: stage.id }, data: { payoutPercent: percents[stage.order - 1]?.payoutPercent ?? 0 } });
    }
    const text = `${user.name} предлагает изменить условия: ${changes.join(", ") || "без изменения цифр"}`;
    await log(tx, deal.id, text, { actorId: user.id, icon: "edit" });
    if (input.comment) {
      await tx.dealEvent.create({ data: { dealId: deal.id, kind: "MESSAGE", actorId: user.id, text: input.comment } });
    }
  });
}

export async function cancelDeal(user: CurrentUser, dealId: string, reason: string) {
  return db.$transaction(async (tx) => {
    const deal = await loadDeal(tx, dealId);
    partyOf(user, deal);
    expectStatus(deal, "PROPOSED", "AWAITING_SIGNATURES", "AWAITING_FUNDING");
    await tx.deal.update({ where: { id: deal.id }, data: { status: "CANCELLED", awaitingParty: null, closedAt: new Date() } });
    await log(tx, deal.id, `${user.name} отменил(а) сделку${reason ? `: «${reason}»` : ""}`, { actorId: user.id, icon: "x" });
  });
}

// ─── Подписание ЭЦП ──────────────────────────────────────────────────────────

export async function signContract(user: CurrentUser, dealId: string, method: SignMethod) {
  return db.$transaction(async (tx) => {
    const deal = await loadDeal(tx, dealId);
    expectStatus(deal, "AWAITING_SIGNATURES");
    const party = partyOf(user, deal);

    const existing = await tx.signature.findUnique({
      where: { dealId_party_revision: { dealId: deal.id, party, revision: deal.revision } },
    });
    if (existing) fail("Вы уже подписали договор");

    const docHash = hashDocument(contractFingerprint(deal));
    const signed = await signatureProvider.sign({ docHash, signerName: user.name, iin: user.iin, method });
    await tx.signature.create({
      data: {
        dealId: deal.id,
        userId: user.id,
        party,
        method: signed.method,
        signerName: user.name,
        iin: user.iin,
        certSerial: signed.certSerial,
        docHash,
        revision: deal.revision,
      },
    });
    const via = method === "EGOV_QR" ? "через eGov Mobile" : "через NCALayer";
    await log(tx, deal.id, `${user.name} подписал(а) договор ЭЦП НУЦ РК ${via}`, { actorId: user.id, icon: "pen" });

    const count = await tx.signature.count({ where: { dealId: deal.id, revision: deal.revision } });
    if (count === 2) {
      const account = await escrowProvider.openAccount({ dealNumber: deal.number, amount: deal.amount });
      await tx.escrowAccount.create({ data: { dealId: deal.id, bank: account.bank, iban: account.iban } });
      await tx.deal.update({ where: { id: deal.id }, data: { status: "AWAITING_FUNDING", signedAt: new Date() } });
      await log(tx, deal.id, `Договор подписан обеими сторонами. Открыт эскроу-счёт ${account.iban}`, { icon: "bank" });
    }
  });
}

// ─── Эскроу ──────────────────────────────────────────────────────────────────

export async function fundEscrow(user: CurrentUser, dealId: string) {
  return db.$transaction(async (tx) => {
    const deal = await loadDeal(tx, dealId);
    expectStatus(deal, "AWAITING_FUNDING");
    if (partyOf(user, deal) !== "CLIENT") fail("Пополняет эскроу заказчик");
    if (!deal.escrow) fail("Эскроу-счёт не открыт");

    await escrowProvider.deposit({ iban: deal.escrow.iban, amount: deal.amount });
    await tx.escrowAccount.update({ where: { id: deal.escrow.id }, data: { status: "FUNDED", funded: deal.amount } });
    await tx.transaction.create({ data: { dealId: deal.id, type: "DEPOSIT", amount: deal.amount, note: "Пополнение эскроу заказчиком" } });
    await tx.deal.update({ where: { id: deal.id }, data: { status: "IN_PROGRESS", fundedAt: new Date() } });
    await tx.stage.update({ where: { id: deal.stages[0].id }, data: { status: "IN_PROGRESS", startedAt: new Date() } });
    await log(tx, deal.id, `${tenge(deal.amount)} заморожены на эскроу-счёте. Мастер может приступать к работе`, {
      actorId: user.id,
      icon: "lock",
    });
  });
}

async function release(tx: Tx, deal: Awaited<ReturnType<typeof loadDeal>>, gross: number, note: string, stageId?: string) {
  if (!deal.escrow || gross <= 0) return null;
  const { commission, net } = split(gross, deal.commissionRate);
  await escrowProvider.release({ iban: deal.escrow.iban, amount: net, commission });
  await tx.transaction.create({ data: { dealId: deal.id, type: "RELEASE", amount: net, note, stageId } });
  await tx.transaction.create({ data: { dealId: deal.id, type: "COMMISSION", amount: commission, note: `Комиссия оператора ${Math.round(deal.commissionRate * 100)}%`, stageId } });
  const released = deal.escrow.released + gross;
  const status = released >= deal.escrow.funded ? "CLOSED" : "PARTIALLY_RELEASED";
  await tx.escrowAccount.update({ where: { id: deal.escrow.id }, data: { released, status } });
  deal.escrow.released = released;
  return { gross, commission, net };
}

// ─── Этапы изготовления ──────────────────────────────────────────────────────

async function loadStage(tx: Tx, stageId: string) {
  const stage = await tx.stage.findUnique({ where: { id: stageId } });
  if (!stage) fail("Этап не найден");
  return { stage, deal: await loadDeal(tx, stage.dealId) };
}

export async function submitStage(user: CurrentUser, stageId: string, report: string, photos: string[]) {
  return db.$transaction(async (tx) => {
    const { stage, deal } = await loadStage(tx, stageId);
    expectStatus(deal, "IN_PROGRESS");
    if (partyOf(user, deal) !== "MASTER") fail("Отчёт по этапу отправляет мастер");
    if (stage.status !== "IN_PROGRESS" && stage.status !== "REWORK") fail("Этап нельзя сдать сейчас");
    if (!report.trim()) fail("Опишите, что сделано на этапе");

    await tx.stage.update({ where: { id: stage.id }, data: { status: "SUBMITTED", report, photos, submittedAt: new Date() } });
    await log(tx, deal.id, `${user.name} сдал(а) этап «${stage.title}» и ждёт подтверждения`, {
      actorId: user.id,
      icon: "upload",
      image: photos[0],
    });
    await tx.dealEvent.create({ data: { dealId: deal.id, kind: "MESSAGE", actorId: user.id, text: report } });
  });
}

export async function approveStage(user: CurrentUser, stageId: string) {
  return db.$transaction(async (tx) => {
    const { stage, deal } = await loadStage(tx, stageId);
    expectStatus(deal, "IN_PROGRESS");
    if (partyOf(user, deal) !== "CLIENT") fail("Этап подтверждает заказчик");
    if (stage.status !== "SUBMITTED") fail("Этап ещё не сдан");

    await tx.stage.update({ where: { id: stage.id }, data: { status: "APPROVED", approvedAt: new Date() } });
    await log(tx, deal.id, `${user.name} подтвердил(а) этап «${stage.title}»`, { actorId: user.id, icon: "check" });

    const next = deal.stages.find((s) => s.order === stage.order + 1);
    if (next) {
      const paid = await release(tx, deal, trancheFor(deal.amount, stage.payoutPercent), `Выплата за этап «${stage.title}»`, stage.id);
      if (paid) {
        await log(tx, deal.id, `Мастеру перечислено ${tenge(paid.net)} за этап «${stage.title}» (комиссия ${tenge(paid.commission)})`, {
          icon: "coins",
        });
      }
      await tx.stage.update({ where: { id: next.id }, data: { status: "IN_PROGRESS", startedAt: new Date() } });
      return;
    }

    // последний этап — раскрываем остаток и закрываем сделку
    const remaining = deal.escrow ? deal.escrow.funded - deal.escrow.released : 0;
    const paid = await release(tx, deal, remaining, "Финальная выплата после приёмки", stage.id);
    await tx.deal.update({ where: { id: deal.id }, data: { status: "COMPLETED", closedAt: new Date() } });
    await log(
      tx,
      deal.id,
      `Сделка завершена. Мастеру перечислено ${tenge(paid?.net ?? 0)}, комиссия оператора ${tenge(paid?.commission ?? 0)}`,
      { icon: "coins" },
    );
  });
}

export async function requestRework(user: CurrentUser, stageId: string, note: string) {
  return db.$transaction(async (tx) => {
    const { stage, deal } = await loadStage(tx, stageId);
    expectStatus(deal, "IN_PROGRESS");
    if (partyOf(user, deal) !== "CLIENT") fail("На доработку возвращает заказчик");
    if (stage.status !== "SUBMITTED") fail("Этап ещё не сдан");
    if (!note.trim()) fail("Опишите, что нужно исправить");

    await tx.stage.update({ where: { id: stage.id }, data: { status: "REWORK", clientNote: note } });
    await log(tx, deal.id, `${user.name} вернул(а) этап «${stage.title}» на доработку`, { actorId: user.id, icon: "undo" });
    await tx.dealEvent.create({ data: { dealId: deal.id, kind: "MESSAGE", actorId: user.id, text: note } });
  });
}

// ─── Споры ───────────────────────────────────────────────────────────────────

export async function openDispute(user: CurrentUser, dealId: string, reason: string) {
  return db.$transaction(async (tx) => {
    const deal = await loadDeal(tx, dealId);
    expectStatus(deal, "IN_PROGRESS");
    partyOf(user, deal);
    if (!reason.trim()) fail("Опишите причину спора");
    const current = deal.stages.find((s) => s.status !== "APPROVED");

    await tx.dispute.create({ data: { dealId: deal.id, stageId: current?.id, openedById: user.id, reason } });
    await tx.deal.update({ where: { id: deal.id }, data: { status: "DISPUTE" } });
    await log(tx, deal.id, `${user.name} открыл(а) спор. Средства остаются замороженными до решения оператора`, {
      actorId: user.id,
      icon: "alert",
    });
    await tx.dealEvent.create({ data: { dealId: deal.id, kind: "MESSAGE", actorId: user.id, text: reason } });
  });
}

export async function resolveDispute(user: CurrentUser, disputeId: string, resolution: DisputeResolution, note: string) {
  if (user.role !== "ADMIN") fail("Спор разрешает оператор платформы");
  return db.$transaction(async (tx) => {
    const dispute = await tx.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute || dispute.status !== "OPEN") fail("Спор не найден или уже закрыт");
    const deal = await loadDeal(tx, dispute.dealId);
    expectStatus(deal, "DISPUTE");
    if (!deal.escrow) fail("Нет эскроу-счёта");

    const remaining = deal.escrow.funded - deal.escrow.released;
    const toMaster = resolution === "RELEASE" ? remaining : resolution === "SPLIT" ? Math.round(remaining / 2) : 0;
    const toClient = remaining - toMaster;

    const paid = await release(tx, deal, toMaster, "Выплата по решению оператора");
    if (toClient > 0) {
      await escrowProvider.refund({ iban: deal.escrow.iban, amount: toClient });
      await tx.transaction.create({ data: { dealId: deal.id, type: "REFUND", amount: toClient, note: "Возврат заказчику по решению оператора" } });
      await tx.escrowAccount.update({
        where: { id: deal.escrow.id },
        data: { refunded: { increment: toClient }, status: toMaster > 0 ? "CLOSED" : "REFUNDED" },
      });
    }

    await tx.dispute.update({ where: { id: dispute.id }, data: { status: "RESOLVED", resolution, resolutionNote: note, resolvedAt: new Date() } });
    await tx.deal.update({
      where: { id: deal.id },
      data: { status: resolution === "REFUND" ? "REFUNDED" : "COMPLETED", closedAt: new Date() },
    });
    const parts = [
      paid ? `мастеру ${tenge(paid.net)}` : null,
      toClient > 0 ? `заказчику возвращено ${tenge(toClient)}` : null,
    ].filter(Boolean);
    await log(tx, deal.id, `Оператор разрешил спор: ${parts.join(", ")}${note ? `. Комментарий: «${note}»` : ""}`, {
      actorId: user.id,
      icon: "scale",
    });
  });
}

// ─── Чат и администрирование ─────────────────────────────────────────────────

export async function sendMessage(user: CurrentUser, dealId: string, text: string, image?: string) {
  const deal = await db.deal.findUnique({ where: { id: dealId } });
  if (!deal) fail("Сделка не найдена");
  if (user.role !== "ADMIN") partyOf(user, deal);
  if (!text.trim() && !image) return;
  await db.dealEvent.create({ data: { dealId, kind: "MESSAGE", actorId: user.id, text: text.trim(), image } });
}

export async function setMasterVerified(user: CurrentUser, masterId: string, verified: boolean) {
  if (user.role !== "ADMIN") fail("Только для оператора");
  await db.masterProfile.update({ where: { userId: masterId }, data: { verified } });
}
