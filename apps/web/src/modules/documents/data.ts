import sharp from "sharp";
import { ru } from "@/i18n/ru";
import { dealDocumentData } from "@/modules/deal-core";
import { storageByName } from "@/modules/files";
import { decryptPii } from "@/platform/crypto";
import type { Db } from "@/platform/db";
import { fail } from "@/platform/errors";
import { logger } from "@/platform/logger";
import { TIME_ZONE } from "@/ui/format";
import { documentNumber } from "./templates/common";
import { subjectDetails } from "./templates/subject";
import type { AcceptanceActData, ContractData, MoneyStatementData, PdfImage, ReleaseReceiptData } from "./templates/types";

/**
 * Данные для шаблонов: деньги, даты, GPS и журнал — из deal-core.dealDocumentData (единый источник),
 * полные ИИН/БИН и IBAN — расшифровываются здесь и попадают только в PDF оферты и расписки.
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
 * ИИН/БИН исполнителя для договора. С плана 2б регистрация пишет его только в identity (binIinEnc пуст); до Task 12
 * (revealParties) такой профиль договора не получает: документ без ИИН/БИН стороны недействителен — лучше отказ, чем пустое поле.
 */
function executorBinIin(binIinEnc: string | null): string {
  if (!binIinEnc) throw new Error("ИИН/БИН исполнителя хранится в identity: договор получит его через RevealPartyDetails (план 2б, Task 12)");
  return decryptPii(binIinEnc);
}

/** Реквизиты сторон для оферты и расписки: расшифровываются только для PDF. */
async function parties(client: Db, dealId: string) {
  const deal = await client.deal.findUniqueOrThrow({
    where: { id: dealId },
    select: {
      client: { select: { fullName: true, iinEnc: true } },
      executor: { select: { legalForm: true, legalName: true, signerFullName: true, binIinEnc: true, payoutIbanEnc: true } },
      request: { select: { customType: true, style: true, details: true, wishes: true, furnitureType: { select: { name: true } } } },
    },
  });
  const { executor, request } = deal;
  return {
    client: { fullName: deal.client.fullName ?? t.clientNameMissing, iin: deal.client.iinEnc ? decryptPii(deal.client.iinEnc) : null },
    executor: { legalForm: executor.legalForm, legalName: executor.legalName, binIin: executorBinIin(executor.binIinEnc), signerFullName: executor.signerFullName },
    iban: executor.payoutIbanEnc ? decryptPii(executor.payoutIbanEnc) : null,
    details: subjectDetails({ furnitureType: request.furnitureType?.name ?? request.customType, style: request.style, details: request.details, wishes: request.wishes }),
  };
}

async function currentNumber(client: Db, dealId: string, kind: "CONTRACT" | "ACCEPTANCE_ACT") {
  const doc = await client.document.findFirst({ where: { dealId, kind, status: { not: "SUPERSEDED" } }, orderBy: { version: "desc" }, select: { number: true, sha256: true } });
  return doc;
}

export async function contractData(client: Db, dealId: string, meta: Meta): Promise<ContractData> {
  // client — часто транзакция: запросы по одному соединению идут только последовательно.
  const d = await dealDocumentData(client, dealId);
  const p = await parties(client, dealId);
  return {
    ...meta,
    city: d.address.city,
    client: p.client,
    executor: p.executor,
    subject: { title: d.deal.title, details: p.details, address: d.address.address },
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

export async function receiptData(client: Db, dealId: string, meta: Meta): Promise<ReleaseReceiptData> {
  // client — часто транзакция: запросы по одному соединению идут только последовательно.
  const d = await dealDocumentData(client, dealId);
  const p = await parties(client, dealId);
  const sum = (type: "SPLIT_MASTER" | "SPLIT_PLATFORM" | "REFUND") =>
    d.moneyHistory.filter((e) => e.type === type && e.status !== "FAILED").reduce((s, e) => s + e.amountTiyn, 0n);
  const release = { masterTiyn: sum("SPLIT_MASTER"), platformTiyn: sum("SPLIT_PLATFORM"), refundTiyn: sum("REFUND") };
  if (release.masterTiyn + release.platformTiyn === 0n) return fail.conflict(t.errors.noRelease);
  const contract = await currentNumber(client, dealId, "CONTRACT");
  const act = await currentNumber(client, dealId, "ACCEPTANCE_ACT");
  if (!contract) return fail.conflict(t.errors.noContract);
  const signedAct = act && (await client.document.findFirst({ where: { dealId, kind: "ACCEPTANCE_ACT", status: "SIGNED" }, select: { number: true, sha256: true } }));
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
