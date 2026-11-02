import type { DocumentKind } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { recordAudit, SYSTEM, type Actor } from "@/modules/audit";
import { saveFile } from "@/modules/files";
import { sha256Hex } from "@/platform/crypto";
import { lockDealRow, type Tx } from "@/platform/db";
import { expectOneUpdated, fail } from "@/platform/errors";
import { logger } from "@/platform/logger";
import { actData, contractData, lastMoneyAt, numberFor, receiptData, statementData, type Meta } from "./data";
import { renderPdf } from "./pdf/render";
import type { PdfSpec } from "./pdf/spec";
import { signingFlags } from "./flags";
import { acceptanceActSpec } from "./templates/acceptance-act";
import { contractSpec } from "./templates/contract";
import { moneyStatementSpec } from "./templates/money-statement";
import { releaseReceiptSpec } from "./templates/release-receipt";

/**
 * Выпуск документов сделки и их версии. Модель версий и хэшей:
 *  - Document = одна версия: PDF в хранилище (StoredFile, назначение DOCUMENT) и sha256 его байтов.
 *    Именно этот хэш подписывают обе стороны (HandSignature.documentSha256, Signature.signedSha256);
 *    файл версии после выпуска не меняется никогда.
 *  - Повторный выпуск при тех же данных возвращает ту же версию: PDF пересобирается с датой текущей
 *    версии и сравнивается по хэшу (рендер детерминирован). Данные изменились — новая версия,
 *    прежняя SUPERSEDED (подписи на ней остаются в истории). Подписанную версию заменить нельзя.
 *  - Подписанная копия (исходный PDF + лист подписей с рисунками подписей) — производная, собирается
 *    при скачивании (read.ts); её хэш не подписывается, в листе указан хэш исходного файла.
 */

const t = ru.documents;
export const scopeOf = (dealId: string) => `deal:${dealId}`;
export type CreatedDocument = { documentId: string; sha256: string };

/** Строка сделки под блокировкой: версии документов одной сделки создаются строго по очереди. */
export async function lockDeal(tx: Tx, dealId: string) {
  if (!(await lockDealRow(tx, dealId))) fail.notFound(ru.deal.errors.notFound);
}

type IssueInput = { dealId: string; kind: DocumentKind; issuedAt: Date; actor?: Actor; build: (meta: Meta) => Promise<PdfSpec> };

async function issue(tx: Tx, input: IssueInput): Promise<CreatedDocument> {
  const { dealId, kind } = input;
  await lockDeal(tx, dealId);
  const current = await tx.document.findFirst({ where: { dealId, kind, status: { not: "SUPERSEDED" } }, orderBy: { version: "desc" } });
  if (current) {
    const same = await renderPdf(await input.build({ number: current.number, version: current.version, issuedAt: current.createdAt }));
    if (sha256Hex(same) === current.sha256) return { documentId: current.id, sha256: current.sha256 };
    if (current.status === "SIGNED") fail.conflict(t.errors.signedContractChange);
    await supersede(tx, { id: current.id, dealId });
  }
  const last = await tx.document.aggregate({ where: { dealId, kind }, _max: { version: true } });
  const meta: Meta = { number: await numberFor(tx, dealId, kind), version: (last._max.version ?? 0) + 1, issuedAt: input.issuedAt };
  const bytes = await renderPdf(await input.build(meta));
  return store(tx, { dealId, kind, ...meta, bytes, actor: input.actor });
}

/** PDF — в хранилище (files.saveFile, назначение DOCUMENT), метаданные — Document с хэшем байтов. */
async function store(tx: Tx, input: Meta & { dealId: string; kind: DocumentKind; bytes: Uint8Array; actor?: Actor }): Promise<CreatedDocument> {
  const sha256 = sha256Hex(input.bytes);
  const file = await saveFile({ purpose: "DOCUMENT", bytes: input.bytes, tx });
  if (file.sha256 !== sha256) {
    logger.error("documents: хранилище изменило байты PDF", { fileId: file.id });
    fail.unavailable(t.errors.damaged);
  }
  const doc = await tx.document.create({
    data: { dealId: input.dealId, kind: input.kind, number: input.number, version: input.version, fileId: file.id, sha256, createdAt: input.issuedAt },
  });
  await recordAudit(tx, {
    actor: input.actor ?? SYSTEM("documents"),
    action: "document.created",
    entity: { type: "document", id: doc.id },
    scope: scopeOf(input.dealId),
    after: { kind: input.kind, number: input.number, version: input.version, sha256 },
  });
  return { documentId: doc.id, sha256 };
}

/** Неподписанная версия больше не подписывается: SIGNING → SUPERSEDED с записью в журнале. */
async function supersede(tx: Tx, doc: { id: string; dealId: string }, meta?: { reason: string }) {
  expectOneUpdated(await tx.document.updateMany({ where: { id: doc.id, status: "SIGNING" }, data: { status: "SUPERSEDED" } }));
  await recordAudit(tx, {
    actor: SYSTEM("documents"),
    action: "document.superseded",
    entity: { type: "document", id: doc.id },
    scope: scopeOf(doc.dealId),
    before: { status: "SIGNING" },
    after: { status: "SUPERSEDED" },
    meta,
  });
}

// ─── порт для deal-core ─────────────────────────────────────────────────────

/** Оферта по сделке (deal-core.createDeal, в той же транзакции). */
export const createContract = (tx: Tx, dealId: string) => createContractIssuedAt(tx, dealId, new Date());
export const createContractIssuedAt = (tx: Tx, dealId: string, issuedAt: Date) =>
  issue(tx, { dealId, kind: "CONTRACT", issuedAt, build: async (meta) => contractSpec(await contractData(tx, dealId, meta)) });

/** Акт приёмки с фото и GPS сдачи (deal-core.submitReady, в той же транзакции). */
export const createAcceptanceAct = (tx: Tx, dealId: string) => createAcceptanceActIssuedAt(tx, dealId, new Date());
export const createAcceptanceActIssuedAt = (tx: Tx, dealId: string, issuedAt: Date) =>
  issue(tx, {
    dealId,
    kind: "ACCEPTANCE_ACT",
    issuedAt,
    build: async (meta) => acceptanceActSpec(await actData(tx, dealId, { ...meta, executorHandSigns: signingFlags().executorHandSignsAct })),
  });

// ─── выписка и расписка ─────────────────────────────────────────────────────

/**
 * Выписка по деньгам: актуальная версия по журналу. Журнал не менялся после выпуска — та же версия
 * без пересборки; менялся — сверка по хэшу и, если нужно, новая версия. Журнал пуст — выписки нет.
 */
export async function ensureMoneyStatement(tx: Tx, dealId: string, now = new Date()): Promise<CreatedDocument | null> {
  const last = await lastMoneyAt(tx, dealId);
  if (!last) return null;
  const current = await tx.document.findFirst({ where: { dealId, kind: "MONEY_STATEMENT", status: { not: "SUPERSEDED" } }, orderBy: { version: "desc" } });
  if (current && current.createdAt >= last) return { documentId: current.id, sha256: current.sha256 };
  return issue(tx, { dealId, kind: "MONEY_STATEMENT", issuedAt: now, build: async (meta) => moneyStatementSpec(await statementData(tx, dealId, meta)) });
}

/** Расписка на раскрытие для банка (manual): по суммам раскрытия в журнале. Выпускает оператор (actor). */
export const issueReleaseReceipt = (tx: Tx, dealId: string, actor: Actor, issuedAt = new Date()) =>
  issue(tx, { dealId, kind: "RELEASE_RECEIPT", issuedAt, actor, build: async (meta) => releaseReceiptSpec(await receiptData(tx, dealId, meta)) });

/**
 * Сделка отменена до заключения оферты: неподписанная оферта снимается с подписи (в той же транзакции,
 * что и отмена). Подписанная остаётся как есть: это документ, а не черновик.
 */
export async function withdrawContract(tx: Tx, dealId: string): Promise<void> {
  await lockDeal(tx, dealId);
  const pending = await tx.document.findMany({ where: { dealId, kind: "CONTRACT", status: "SIGNING" }, select: { id: true } });
  for (const doc of pending) await supersede(tx, { id: doc.id, dealId }, { reason: "deal.cancelled" });
}
