import sharp from "sharp";
import { ru } from "@/i18n/ru";
import { dealDocumentData } from "@/modules/deal-core";
import { storageByName } from "@/modules/files";
import { revealParties, type CurrentUser, type RevealPurposeName } from "@/modules/identity";
import type { Db } from "@/platform/db";
import { fail } from "@/platform/errors";
import { logger } from "@/platform/logger";
import { TIME_ZONE } from "@/ui/format";
import { documentNumber } from "./templates/common";
import { subjectDetails } from "./templates/subject";
import type { AcceptanceActData, ContractData, ExecutorParty, MoneyStatementData, PdfImage, ReleaseReceiptData } from "./templates/types";

/**
 * Данные для шаблонов: деньги, даты, GPS и журнал — из deal-core.dealDocumentData (единый источник),
 * полные ИИН/БИН и IBAN — из identity (revealParties) и попадают только в PDF оферты и расписки.
 */

const t = ru.documents;
export type Meta = { number: string; version: number; issuedAt: Date };

export const yearIn = (d: Date) => Number(new Intl.DateTimeFormat("en", { year: "numeric", timeZone: TIME_ZONE }).format(d));

/** Номер документа сделки по виду. */
export async function numberFor(client: Db, dealId: string, kind: keyof typeof documentNumber): Promise<string> {
  const deal = await client.deal.findUniqueOrThrow({ where: { id: dealId }, select: { number: true, createdAt: true } });
  return kind === "CONTRACT" ? documentNumber.CONTRACT(deal.number, yearIn(deal.createdAt)) : documentNumber[kind](deal.number);
}

/**
 * Реквизиты сторон для оферты и расписки — из identity (RevealPartyDetails с целью и сделкой; аудит pii.revealed пишет identity).
 * Стороны — заказчик и исполнитель этой сделки; actor — кто выпускает документ (оператор — расписку; оферту выпускает система).
 * Нет ИИН/БИН исполнителя — документ без ИИН/БИН стороны недействителен: лучше отказ, чем пустое поле.
 */
async function parties(client: Db, dealId: string, purpose: RevealPurposeName, actor?: CurrentUser) {
  const deal = await client.deal.findUniqueOrThrow({ where: { id: dealId }, select: { clientId: true, client: { select: { fullName: true } }, executor: { select: { userId: true } } } });
  const revealed = await revealParties([deal.clientId, deal.executor.userId], purpose, dealId, actor, client);
  const buyer = revealed.get(deal.clientId);
  const master = revealed.get(deal.executor.userId);
  if (!master?.legalForm || !master.legalName || !master.binIin) throw new Error("ИИН/БИН исполнителя не получен из identity (RevealPartyDetails): документ без него недействителен");
  const executor: ExecutorParty = { legalForm: master.legalForm, legalName: master.legalName, binIin: master.binIin, signerFullName: master.signerFullName };
  return {
    client: { fullName: buyer?.fullName ?? deal.client.fullName ?? t.clientNameMissing, iin: buyer?.iin ?? null },
    executor,
    iban: master.payoutIban,
  };
}

/** Предмет договора: тип мебели, стиль, детали и пожелания заявки. */
async function subject(client: Db, dealId: string) {
  const { request } = await client.deal.findUniqueOrThrow({
    where: { id: dealId },
    select: { request: { select: { customType: true, style: true, details: true, wishes: true, furnitureType: { select: { name: true } } } } },
  });
  return subjectDetails({ furnitureType: request.furnitureType?.name ?? request.customType, style: request.style, details: request.details, wishes: request.wishes });
}

async function currentNumber(client: Db, dealId: string, kind: "CONTRACT" | "ACCEPTANCE_ACT") {
  const doc = await client.document.findFirst({ where: { dealId, kind, status: { not: "SUPERSEDED" } }, orderBy: { version: "desc" }, select: { number: true, sha256: true } });
  return doc;
}

export async function contractData(client: Db, dealId: string, meta: Meta): Promise<ContractData> {
  // client — часто транзакция: запросы по одному соединению идут только последовательно.
  const d = await dealDocumentData(client, dealId);
  const details = await subject(client, dealId);
  // Оферту выпускает система в транзакции createDeal (document.created — от SYSTEM): раскрытие без сессии человека.
  const p = await parties(client, dealId, "CONTRACT");
  return {
    ...meta,
    city: d.address.city,
    client: p.client,
    executor: p.executor,
    subject: { title: d.deal.title, details, address: d.address.address },
    money: d.money,
    durationDays: d.deal.durationDays,
    warrantyMonths: d.deal.warrantyMonths,
    provider: d.deal.paymentProvider,
    isDemo: d.deal.isDemo,
  };
}

/**
 * Фото сдачи для акта: читаем из хранилища и приводим к JPEG ≤ 1000 px (PDF понимает только JPEG и PNG,
 * а файл с телефона весит мегабайты). Файл недоступен — в акте остаётся его хэш и рамка.
 */
async function pdfPhoto(file: { provider: string; storageKey: string }): Promise<PdfImage | null> {
  try {
    const bytes = await (await storageByName(file.provider)).get(file.storageKey);
    if (!bytes) return null;
    const jpeg = await sharp(bytes).rotate().resize({ width: 1000, height: 1000, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
    return { bytes: new Uint8Array(jpeg), format: "jpg" };
  } catch (e) {
    logger.warn("documents: фото сдачи не встроено в акт", { storageKey: file.storageKey, error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

export async function actData(client: Db, dealId: string, meta: Meta & { executorHandSigns: boolean }): Promise<AcceptanceActData> {
  const d = await dealDocumentData(client, dealId);
  if (!d.ready) return fail.conflict(t.errors.notReady);
  const contract = await currentNumber(client, dealId, "CONTRACT");
  if (!contract) return fail.conflict(t.errors.noContract);
  const files = await client.storedFile.findMany({ where: { id: { in: d.ready.photos.map((p) => p.id) } }, select: { id: true, sha256: true } });
  const shaOf = new Map(files.map((f) => [f.id, f.sha256]));
  const { ready } = d;
  return {
    ...meta,
    city: d.address.city,
    contractNumber: contract.number,
    dealTitle: d.deal.title,
    clientName: d.client.fullName ?? t.clientNameMissing,
    executorName: d.executor.legalName,
    money: d.money,
    readyAt: ready.at,
    photos: await Promise.all(ready.photos.map(async (p) => ({ image: await pdfPhoto(p), sha256: shaOf.get(p.id) ?? "" }))),
    gps: ready.distanceM === null ? null : { distanceM: ready.distanceM, withinRadius: ready.withinRadius, radiusM: ready.radiusM, accuracyM: ready.accuracyM },
    isDemo: d.deal.isDemo,
  };
}

export async function statementData(client: Db, dealId: string, meta: Meta): Promise<MoneyStatementData> {
  const d = await dealDocumentData(client, dealId);
  const contract = await currentNumber(client, dealId, "CONTRACT");
  return {
    ...meta,
    contractNumber: contract?.number ?? null,
    dealTitle: d.deal.title,
    money: d.money,
    entries: d.moneyHistory.map((e) => ({ type: e.type, status: e.status, amountTiyn: e.amountTiyn, at: e.at, operationRef: e.operationRef, isTest: e.isTest })),
    bankBalanceTiyn: d.moneyBlock.bankBalanceTiyn,
    isDemo: d.deal.isDemo,
  };
}

/** Последний момент журнала: выписка старше него — устарела. */
export async function lastMoneyAt(client: Db, dealId: string): Promise<Date | null> {
  const d = await dealDocumentData(client, dealId);
  return d.moneyHistory.reduce<Date | null>((max, e) => (!max || e.at > max ? e.at : max), null);
}

/** Расписку выпускает оператор (actor): его сессия уходит в identity, второй фактор проверяет identity. */
export async function receiptData(client: Db, dealId: string, meta: Meta, actor: CurrentUser): Promise<ReleaseReceiptData> {
  // client — часто транзакция: запросы по одному соединению идут только последовательно.
  const d = await dealDocumentData(client, dealId);
  const sum = (type: "SPLIT_MASTER" | "SPLIT_PLATFORM" | "REFUND") =>
    d.moneyHistory.filter((e) => e.type === type && e.status !== "FAILED").reduce((s, e) => s + e.amountTiyn, 0n);
  const release = { masterTiyn: sum("SPLIT_MASTER"), platformTiyn: sum("SPLIT_PLATFORM"), refundTiyn: sum("REFUND") };
  if (release.masterTiyn + release.platformTiyn === 0n) return fail.conflict(t.errors.noRelease);
  const contract = await currentNumber(client, dealId, "CONTRACT");
  const act = await currentNumber(client, dealId, "ACCEPTANCE_ACT");
  if (!contract) return fail.conflict(t.errors.noContract);
  const signedAct = act && (await client.document.findFirst({ where: { dealId, kind: "ACCEPTANCE_ACT", status: "SIGNED" }, select: { number: true, sha256: true } }));
  // ПДн — после всех проверок: без раскрытия денег и оферты реквизиты не раскрываются.
  const p = await parties(client, dealId, "RELEASE_RECEIPT", actor);
  return {
    ...meta,
    city: d.address.city,
    contractNumber: contract.number,
    actNumber: signedAct ? signedAct.number : null,
    actSha256: signedAct ? signedAct.sha256 : null,
    client: p.client,
    executor: { ...p.executor, iban: p.iban },
    money: d.money,
    release,
  };
}
