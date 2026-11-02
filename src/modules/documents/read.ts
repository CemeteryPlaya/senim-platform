import { ru } from "@/i18n/ru";
import { recordAudit, SYSTEM } from "@/modules/audit";
import { storageByName } from "@/modules/files";
import { actorOf, type CurrentUser } from "@/modules/identity";
import { sha256Hex } from "@/platform/crypto";
import { db, transaction } from "@/platform/db";
import { env } from "@/platform/env";
import { fail } from "@/platform/errors";
import { logger } from "@/platform/logger";
import { canRead, partyOf } from "./access";
import { signingFlags } from "./flags";
import { ensureMoneyStatement, issueReleaseReceipt, scopeOf, type CreatedDocument } from "./issue";
import { LINK_TTL_SEC, openDocumentLink, sealDocumentLink, whatsappShareUrl } from "./links";
import { appendPages, renderPdf } from "./pdf/render";
import { dealAcceptsSignature, readableDocument } from "./signing";
import { signatureSheetSpec } from "./templates/signature-sheet";
import type { PdfImage, SignatureSheetData } from "./templates/types";
import { toSigningView, type SharedLink, type SigningDocumentView } from "./views";

const t = ru.documents;

/** Вид PDF: подписанная копия (с листом подписей) или исходный файл, хэш которого подписан. */
export type PdfVariant = "signed" | "original";
export type PdfFile = { bytes: Uint8Array; fileName: string; sha256: string };

const withSignatures = {
  signatures: { orderBy: { signedAt: "asc" } },
  handSignatures: { orderBy: { signedAt: "asc" }, include: { imageFile: { select: { provider: true, storageKey: true } } } },
  file: { select: { provider: true, storageKey: true } },
  deal: { select: { client: { select: { fullName: true } }, executor: { select: { legalName: true } } } },
} as const;

async function loadFull(documentId: string) {
  return db.document.findUnique({ where: { id: documentId }, include: withSignatures });
}
type FullDocument = NonNullable<Awaited<ReturnType<typeof loadFull>>>;

/** Байты версии из хранилища, сверенные с Document.sha256: подменённый файл не отдаём. */
async function originalBytes(doc: FullDocument): Promise<Uint8Array> {
  const bytes = await (await storageByName(doc.file.provider)).get(doc.file.storageKey);
  if (!bytes) return fail.notFound(t.errors.notFound);
  if (sha256Hex(bytes) !== doc.sha256) {
    logger.error("documents: хэш файла не совпадает с документом", { documentId: doc.id });
    return fail.unavailable(t.errors.damaged);
  }
  return bytes;
}

async function handImage(file: { provider: string; storageKey: string } | null): Promise<PdfImage | null> {
  if (!file) return null;
  const bytes = await (await storageByName(file.provider)).get(file.storageKey);
  return bytes ? { bytes, format: "png" } : null;
}

const title = (doc: Pick<FullDocument, "kind" | "number" | "version">) => `${t.kinds[doc.kind]} № ${doc.number}, ${t.panel.version(doc.version)}`;

async function sheetData(doc: FullDocument): Promise<SignatureSheetData> {
  const names = { CLIENT: doc.deal.client.fullName ?? t.clientNameMissing, EXECUTOR: doc.deal.executor.legalName };
  const parties = await Promise.all(
    (["CLIENT", "EXECUTOR"] as const).map(async (party) => {
      const hand = doc.handSignatures.find((h) => h.party === party);
      const ecp = doc.signatures.find((s) => s.party === party);
      return {
        party,
        role: t.parties[party],
        name: names[party],
        hand: hand ? { image: await handImage(hand.imageFile), typedName: hand.typedName, signedAt: hand.signedAt, documentSha256: hand.documentSha256 } : null,
        ecp: ecp ? { method: ecp.method, signedAt: ecp.signedAt, signedSha256: ecp.signedSha256, certSubject: ecp.certSubject, certSerial: ecp.certSerial, certIinLast4: ecp.certIinLast4 } : null,
      };
    }),
  );
  const times = [...doc.handSignatures, ...doc.signatures].map((s) => s.signedAt.getTime());
  return { documentTitle: title(doc), sha256: doc.sha256, issuedAt: new Date(Math.max(...times)), parties };
}

/**
 * Подписанная копия: исходный PDF без изменений + лист подписей (рисунки подписей, время, данные ЭЦП).
 * Подписей нет — исходный файл. Собирается детерминированно: одни и те же подписи — те же байты.
 */
async function pdfOf(doc: FullDocument, variant: PdfVariant): Promise<PdfFile> {
  const original = await originalBytes(doc);
  const base = `${doc.number.replace(/[^\p{L}\p{N}-]+/gu, "-")}-v${doc.version}`;
  const signed = doc.handSignatures.length + doc.signatures.length > 0;
  if (variant === "original" || !signed) return { bytes: original, fileName: `${base}.pdf`, sha256: doc.sha256 };
  const data = await sheetData(doc);
  const bytes = await appendPages(original, await renderPdf(signatureSheetSpec(data)), data.issuedAt);
  return { bytes, fileName: `${base}-подписи.pdf`, sha256: doc.sha256 };
}

/** PDF для маршрута /api/documents/[id]/pdf. Только стороны сделки и оператор. */
export async function getDocumentPdf(user: CurrentUser, documentId: string, variant: PdfVariant = "signed"): Promise<PdfFile> {
  await readableDocument(user, documentId);
  const doc = await loadFull(documentId);
  if (!doc) return fail.notFound(t.errors.notFound);
  return pdfOf(doc, variant);
}

/** Подписанная копия для письма (фоновая задача, без пользователя). */
export async function signedCopyForEmail(documentId: string): Promise<{ bytes: Uint8Array; fileName: string }> {
  const doc = await loadFull(documentId);
  if (!doc) return fail.notFound(t.errors.notFound);
  return pdfOf(doc, "signed");
}

/**
 * Документы сделки для раздела «Документы» (без заменённых версий) — сторонам и оператору.
 * Выписка по деньгам выпускается здесь же, если журнал изменился после прошлой версии (идемпотентно).
 */
export async function listDealDocuments(user: CurrentUser, dealId: string): Promise<SigningDocumentView[]> {
  const deal = await db.deal.findUnique({ where: { id: dealId }, select: { clientId: true, executor: { select: { userId: true } } } });
  if (!deal || !canRead(user, deal)) return fail.notFound(t.errors.notFound);
  await transaction((tx) => ensureMoneyStatement(tx, dealId));
  const myParty = partyOf(user, deal);
  const flags = signingFlags();
  const docs = await db.document.findMany({
    where: { dealId, status: { not: "SUPERSEDED" }, kind: { in: user.role === "OPERATOR" ? ["CONTRACT", "ACCEPTANCE_ACT", "MONEY_STATEMENT", "RELEASE_RECEIPT"] : ["CONTRACT", "ACCEPTANCE_ACT", "MONEY_STATEMENT"] } },
    include: {
      signatures: { select: { party: true, signedAt: true, signedSha256: true, method: true }, orderBy: { signedAt: "asc" } },
      handSignatures: { select: { party: true, signedAt: true, documentSha256: true, imageFileId: true }, orderBy: { signedAt: "asc" } },
    },
    orderBy: [{ kind: "asc" }, { version: "desc" }],
  });
  return Promise.all(docs.map(async (d) => toSigningView(d, { myParty, flags, stepOpen: await dealAcceptsSignature(db, dealId, d.kind) })));
}

// ─── ссылки «Поделиться» ────────────────────────────────────────────────────

/** Подписанная ссылка на документ для пересылки (WhatsApp): стороны сделки и оператор. */
export async function shareDocument(user: CurrentUser, documentId: string): Promise<SharedLink> {
  const doc = await readableDocument(user, documentId);
  const { token, expiresAt } = sealDocumentLink(doc.id);
  const url = new URL(`/d/${token}`, env().APP_URL).toString();
  await recordAudit(db, { actor: actorOf(user), action: "document.link.created", entity: { type: "document", id: doc.id }, scope: scopeOf(doc.dealId), meta: { expiresAt: expiresAt.toISOString() } });
  return { url, expiresAt, whatsappUrl: whatsappShareUrl(t.section.shareText(t.kinds[doc.kind]), url) };
}

export const LINK_TTL_HOURS = LINK_TTL_SEC / 3600;

export type SharedDocumentView = { kind: FullDocument["kind"]; number: string; version: number; status: FullDocument["status"]; sha256: string; expiresAt: Date; signedCount: number };

/** Документ по подписанной ссылке (страница /d/[token]). Недействительная ссылка — null. Открытие — в аудит. */
export async function openSharedDocument(token: string): Promise<SharedDocumentView | null> {
  const link = openDocumentLink(token);
  if (!link) return null;
  const doc = await loadFull(link.documentId);
  if (!doc) return null;
  await recordAudit(db, { actor: SYSTEM("documents.link"), action: "document.link.opened", entity: { type: "document", id: doc.id }, scope: scopeOf(doc.dealId) });
  return { kind: doc.kind, number: doc.number, version: doc.version, status: doc.status, sha256: doc.sha256, expiresAt: link.expiresAt, signedCount: doc.handSignatures.length + doc.signatures.length };
}

/** PDF по подписанной ссылке; недействительная ссылка — «не найден». */
export async function getSharedDocumentPdf(token: string, variant: PdfVariant = "signed"): Promise<PdfFile> {
  const link = openDocumentLink(token);
  const doc = link && (await loadFull(link.documentId));
  if (!doc) return fail.notFound(t.errors.notFound);
  return pdfOf(doc, variant);
}

// ─── оператор ───────────────────────────────────────────────────────────────

/** Расписка на раскрытие для банка (manual): только оператор. Повтор при тех же суммах — та же версия. */
export async function createReleaseReceipt(user: CurrentUser, dealId: string): Promise<CreatedDocument> {
  if (user.role !== "OPERATOR") return fail.forbidden();
  const exists = await db.deal.findUnique({ where: { id: dealId }, select: { id: true } });
  if (!exists) return fail.notFound(ru.deal.errors.notFound);
  return transaction((tx) => issueReleaseReceipt(tx, dealId, actorOf(user)));
}
