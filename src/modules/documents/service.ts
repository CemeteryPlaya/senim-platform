import "server-only";
import QRCode from "qrcode";
import type { DocumentKind, DocumentStatus, SignMethod, SignParty } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { recordAudit, SYSTEM } from "@/modules/audit";
import { saveFile, storageByName } from "@/modules/files";
import { actorOf, type CurrentUser } from "@/modules/identity";
import { notify } from "@/modules/notifications";
import { decryptPii, sha256Hex } from "@/platform/crypto";
import { db, lockDealRow, transaction, type Tx } from "@/platform/db";
import { expectOneUpdated, fail } from "@/platform/errors";
import { logger } from "@/platform/logger";
import { TIME_ZONE } from "@/ui/format";
import { canRead, partyOf } from "./access";
import type { CompleteSigning, CreateContract, CreatedDocument, CreateStageAct } from "./contracts";
import { renderPdf } from "./pdf/render";
import { signatureProvider } from "./providers";
import { contractNumber, stageActNumber } from "./templates/common";
import { contractSpec } from "./templates/contract";
import { stageActSpec } from "./templates/stage-act";
import { subjectDetails } from "./templates/subject";
import type { ContractData } from "./templates/types";
import type { SigningDocumentView, StartedSigning } from "./views";

const t = ru.documents;
const scopeOf = (dealId: string) => `deal:${dealId}`;

/** Строка сделки под блокировкой: версии договора и акты одной сделки создаются строго по очереди. */
async function lockDeal(tx: Tx, dealId: string) {
  if (!(await lockDealRow(tx, dealId))) fail.notFound("Сделка не найдена");
}

const yearIn = (d: Date) => Number(new Intl.DateTimeFormat("en", { year: "numeric", timeZone: TIME_ZONE }).format(d));

// ─── формирование ───────────────────────────────────────────────────────────

function loadDealForContract(tx: Tx, dealId: string) {
  return tx.deal.findUniqueOrThrow({
    where: { id: dealId },
    include: {
      client: true,
      executor: true,
      offer: true,
      request: { include: { furnitureType: true } },
      stages: { orderBy: { order: "asc" } },
    },
  });
}

type DealForContract = Awaited<ReturnType<typeof loadDealForContract>>;

/**
 * Данные договора. Здесь — единственное место, где расшифровывается ИИН/БИН исполнителя:
 * он попадает только в PDF договора. Заказчик в договоре — ФИО и ИИН (сторона договора
 * должна быть определена так же, как исполнитель); телефонов в договоре нет.
 */
function toContractData(deal: DealForContract, meta: { number: string; version: number; issuedAt: Date }): ContractData {
  const { request } = deal;
  return {
    ...meta,
    city: request.city,
    paymentMode: deal.paymentMode,
    client: { fullName: deal.client.fullName ?? t.clientNameMissing, iin: deal.client.iinEnc ? decryptPii(deal.client.iinEnc) : null },
    executor: { legalForm: deal.executor.legalForm, legalName: deal.executor.legalName, binIin: decryptPii(deal.executor.binIinEnc) },
    subject: {
      title: deal.title,
      details: subjectDetails({
        furnitureType: request.furnitureType?.name ?? request.customType,
        style: request.style,
        details: request.details,
        wishes: request.wishes,
      }),
      address: request.address,
    },
    totalAmount: deal.totalAmount,
    stages: deal.stages.map((s) => ({ order: s.order, title: s.title, description: s.description, amount: s.amount, paymentDue: s.paymentDue })),
    durationDays: deal.offer.durationDays,
    warrantyMonths: deal.offer.warrantyMonths,
    autoAcceptDays: deal.autoAcceptDays,
  };
}

/** PDF — в хранилище (files.saveFile, назначение DOCUMENT), метаданные — Document с хэшем байтов. */
async function storeDocument(
  tx: Tx,
  input: { dealId: string; stageId?: string; kind: DocumentKind; number: string; version: number; issuedAt: Date; bytes: Uint8Array },
): Promise<CreatedDocument> {
  const sha256 = sha256Hex(input.bytes);
  const file = await saveFile({ purpose: "DOCUMENT", bytes: input.bytes, tx });
  if (file.sha256 !== sha256) {
    logger.error("documents: хранилище изменило байты PDF", { fileId: file.id });
    fail.unavailable(t.errors.damaged);
  }
  const doc = await tx.document.create({
    data: {
      dealId: input.dealId,
      stageId: input.stageId,
      kind: input.kind,
      number: input.number,
      version: input.version,
      fileId: file.id,
      sha256,
      createdAt: input.issuedAt,
    },
  });
  await recordAudit(tx, {
    actor: SYSTEM("documents"),
    action: "document.created",
    entity: { type: "document", id: doc.id },
    scope: scopeOf(input.dealId),
    after: { kind: input.kind, number: input.number, version: input.version, sha256 },
  });
  return { documentId: doc.id, sha256 };
}

/**
 * deal-core → documents. Повтор без изменения условий возвращает тот же документ
 * (PDF перестраивается с датой текущей версии и сравнивается по хэшу); изменились — новая версия,
 * старая SUPERSEDED. Подписанный договор не перевыпускается.
 */
export const createContract: CreateContract = async (tx, dealId) => {
  await lockDeal(tx, dealId);
  const deal = await loadDealForContract(tx, dealId);
  const current = await tx.document.findFirst({
    where: { dealId, kind: "CONTRACT", status: { not: "SUPERSEDED" } },
    orderBy: { version: "desc" },
  });

  if (current) {
    const same = await renderPdf(contractSpec(toContractData(deal, { number: current.number, version: current.version, issuedAt: current.createdAt })));
    if (sha256Hex(same) === current.sha256) return { documentId: current.id, sha256: current.sha256 };
    if (current.status === "SIGNED") fail.conflict(t.errors.signedContractChange);
    expectOneUpdated(await tx.document.updateMany({ where: { id: current.id, status: "SIGNING" }, data: { status: "SUPERSEDED" } }));
    await recordAudit(tx, {
      actor: SYSTEM("documents"),
      action: "document.superseded",
      entity: { type: "document", id: current.id },
      scope: scopeOf(dealId),
      before: { status: current.status },
      after: { status: "SUPERSEDED" },
    });
  }

  const last = await tx.document.aggregate({ where: { dealId, kind: "CONTRACT" }, _max: { version: true } });
  const version = (last._max.version ?? 0) + 1;
  const number = contractNumber(deal.number, yearIn(deal.createdAt));
  const issuedAt = new Date();
  const bytes = await renderPdf(contractSpec(toContractData(deal, { number, version, issuedAt })));
  return storeDocument(tx, { dealId, kind: "CONTRACT", number, version, issuedAt, bytes });
};

/** deal-core → documents: акт после приёмки этапа. Один акт на этап; повтор возвращает тот же. */
export const createStageAct: CreateStageAct = async (tx, stageId) => {
  const ref = await tx.stage.findUnique({ where: { id: stageId }, select: { dealId: true } });
  if (!ref) return fail.notFound("Этап не найден");
  await lockDeal(tx, ref.dealId);

  const stage = await tx.stage.findUniqueOrThrow({ where: { id: stageId }, include: { deal: { include: { request: { select: { city: true } } } } } });
  if (stage.status !== "ACCEPTED" && stage.status !== "CLOSED") fail.conflict(t.errors.stageNotAccepted);

  const existing = await tx.document.findFirst({ where: { stageId, kind: "STAGE_ACT", status: { not: "SUPERSEDED" } } });
  if (existing) return { documentId: existing.id, sha256: existing.sha256 };

  const contract = await tx.document.findFirst({
    where: { dealId: stage.dealId, kind: "CONTRACT", status: { not: "SUPERSEDED" } },
    orderBy: { version: "desc" },
  });
  if (!contract) return fail.conflict(t.errors.noContract);

  const { deal } = stage;
  const issuedAt = new Date();
  const number = stageActNumber(deal.number, stage.order);
  const bytes = await renderPdf(
    stageActSpec({
      number,
      issuedAt,
      city: deal.request.city,
      paymentMode: deal.paymentMode,
      contractNumber: contract.number,
      dealTitle: deal.title,
      stage: { order: stage.order, title: stage.title, description: stage.description, amount: stage.amount, paymentDue: stage.paymentDue },
      acceptedAt: stage.acceptedAt ?? issuedAt,
      acceptedAutomatically: stage.acceptedBy?.startsWith("system:") ?? false,
      autoAcceptDays: deal.autoAcceptDays,
    }),
  );
  return storeDocument(tx, { dealId: stage.dealId, stageId, kind: "STAGE_ACT", number, version: 1, issuedAt, bytes });
};

// ─── доступ ─────────────────────────────────────────────────────────────────

function loadDocument(documentId: string) {
  return db.document.findUnique({
    where: { id: documentId },
    include: {
      deal: { select: { id: true, clientId: true, executor: { select: { userId: true } } } },
      file: { select: { provider: true, storageKey: true } },
      signatures: { select: { party: true } },
    },
  });
}

type LoadedDocument = NonNullable<Awaited<ReturnType<typeof loadDocument>>>;

/** Документ, который пользователь вправе видеть; иначе «не найден» (не раскрываем, что он существует). */
async function readable(user: CurrentUser, documentId: string): Promise<LoadedDocument> {
  const doc = await loadDocument(documentId);
  if (!doc || !canRead(user, doc.deal)) return fail.notFound(t.errors.notFound);
  return doc;
}

/** Сторона, которая может подписать документ сейчас. */
async function signableBy(user: CurrentUser, documentId: string): Promise<{ doc: LoadedDocument; party: SignParty }> {
  const doc = await readable(user, documentId);
  const party = partyOf(user, doc.deal);
  if (!party) return fail.forbidden(t.errors.operatorCannotSign);
  assertSignable(doc.status, doc.signatures, party);
  return { doc, party };
}

function assertSignable(status: DocumentStatus, signatures: { party: SignParty }[], party: SignParty) {
  if (status === "SUPERSEDED") fail.conflict(t.errors.superseded);
  if (status === "SIGNED") fail.conflict(t.errors.alreadySigned);
  if (signatures.some((s) => s.party === party)) fail.conflict(t.errors.alreadySignedByYou);
}

// ─── подпись ────────────────────────────────────────────────────────────────

/** Начать подпись стороной сделки. Подписывается sha256 PDF, сохранённый в Document. */
export async function startSigning(user: CurrentUser, documentId: string, method: SignMethod): Promise<StartedSigning> {
  const { doc } = await signableBy(user, documentId);
  const me = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { fullName: true, iinLast4: true } });
  const provider = signatureProvider();
  const session = await provider.startSigning({
    documentId,
    sha256: doc.sha256,
    method,
    signer: { userId: user.id, fullName: me.fullName ?? "", iinLast4: me.iinLast4 ?? undefined },
  });
  await recordAudit(db, {
    actor: actorOf(user),
    action: "document.signing.started",
    entity: { type: "document", id: documentId },
    scope: scopeOf(doc.dealId),
    meta: { method, provider: provider.name },
  });
  const qrImage = session.qrPayload ? await QRCode.toDataURL(session.qrPayload, { margin: 1, width: 288 }) : undefined;
  return { ...session, qrImage, provider: provider.name };
}

/**
 * Завершить подпись: сервер сам берёт CMS у провайдера и проверяет её (verify) против хэша документа.
 * Подпись сохраняется только при valid и совпадении sha256. Двойное нажатие — одна запись:
 * строка документа блокируется, вторая попытка видит готовую подпись и получает CONFLICT.
 */
export const completeSigning: CompleteSigning = async (user, { documentId, sessionId }, hooks) => {
  const { doc, party } = await signableBy(user, documentId);
  const provider = signatureProvider();

  const result = await provider.getResult(sessionId);
  if (result.status === "pending") return fail.conflict(t.errors.pending);
  if (result.status === "failed") return fail.validation(t.errors.rejected(result.error));

  const verified = await provider.verify({ cms: result.cms, sha256: doc.sha256 });
  if (!verified.valid) return fail.validation(t.errors.rejected(verified.reason));

  const me = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { iinLast4: true } });
  if (verified.certIinLast4 && me.iinLast4 && verified.certIinLast4 !== me.iinLast4) return fail.validation(t.errors.otherSigner);

  return transaction(async (tx) => {
    // Порядок блокировок как в createContract и deal-core: сначала сделка, потом документ.
    await lockDeal(tx, doc.dealId);
    const [locked] = await tx.$queryRaw<{ status: DocumentStatus; sha256: string }[]>`
      SELECT status, sha256 FROM "Document" WHERE id = ${documentId} FOR UPDATE`;
    const signatures = await tx.signature.findMany({ where: { documentId }, select: { party: true } });
    assertSignable(locked.status, signatures, party);
    if (locked.sha256 !== doc.sha256) fail.conflict();

    await tx.signature.create({
      data: {
        documentId,
        userId: user.id,
        party,
        method: result.method,
        signedSha256: doc.sha256,
        signature: result.cms,
        certSubject: verified.certSubject,
        certSerial: verified.certSerial,
        certIinLast4: verified.certIinLast4,
        verified: true,
        signedAt: verified.signedAt,
      },
    });
    await recordAudit(tx, {
      actor: actorOf(user),
      action: "document.signature.added",
      entity: { type: "document", id: documentId },
      scope: scopeOf(doc.dealId),
      after: { party, method: result.method, signedSha256: doc.sha256, certSerial: verified.certSerial },
    });

    const kind = t.kinds[doc.kind];
    const otherUserId = party === "CLIENT" ? doc.deal.executor.userId : doc.deal.clientId;
    const link = `/deals/${doc.dealId}`;
    if (signatures.length + 1 < 2) {
      await notify(tx, { userId: otherUserId, kind: "document.signed_by_party", title: t.notify.signedByParty.title(kind), body: t.notify.signedByParty.body(doc.number), link });
      return { fullySigned: false };
    }

    expectOneUpdated(await tx.document.updateMany({ where: { id: documentId, status: "SIGNING" }, data: { status: "SIGNED", signedAt: new Date() } }));
    await recordAudit(tx, {
      actor: actorOf(user),
      action: "document.signed",
      entity: { type: "document", id: documentId },
      scope: scopeOf(doc.dealId),
      before: { status: "SIGNING" },
      after: { status: "SIGNED", sha256: doc.sha256 },
    });
    await notify(tx, { userId: otherUserId, kind: "document.fully_signed", title: t.notify.fullySigned.title(kind), body: t.notify.fullySigned.body(doc.number), link });
    await hooks.onFullySigned(tx, documentId);
    return { fullySigned: true };
  });
};

// ─── чтение ─────────────────────────────────────────────────────────────────

/** Байты PDF для маршрута /api/documents/[id]/pdf. Только стороны сделки и оператор; хэш сверяется с Document. */
export async function getDocumentPdf(user: CurrentUser, documentId: string): Promise<{ bytes: Uint8Array; fileName: string; sha256: string }> {
  const doc = await readable(user, documentId);
  const bytes = await (await storageByName(doc.file.provider)).get(doc.file.storageKey);
  if (!bytes) return fail.notFound(t.errors.notFound);
  if (sha256Hex(bytes) !== doc.sha256) {
    logger.error("documents: хэш файла не совпадает с документом", { documentId });
    return fail.unavailable(t.errors.damaged);
  }
  const fileName = `${doc.number.replace(/[^\p{L}\p{N}-]+/gu, "-")}-v${doc.version}.pdf`;
  return { bytes, fileName, sha256: doc.sha256 };
}

/** Действующие документы сделки (без заменённых версий) для сторон и оператора. */
export async function listDealDocuments(user: CurrentUser, dealId: string): Promise<SigningDocumentView[]> {
  const deal = await db.deal.findUnique({ where: { id: dealId }, select: { clientId: true, executor: { select: { userId: true } } } });
  if (!deal || !canRead(user, deal)) return fail.notFound(t.errors.notFound);
  const myParty = partyOf(user, deal);
  const docs = await db.document.findMany({
    where: { dealId, status: { not: "SUPERSEDED" } },
    include: { signatures: { select: { party: true, signedAt: true, signedSha256: true, method: true }, orderBy: { signedAt: "asc" } } },
    orderBy: [{ kind: "asc" }, { createdAt: "asc" }],
  });
  return docs.map((d) => ({
    id: d.id,
    dealId: d.dealId,
    stageId: d.stageId,
    kind: d.kind,
    number: d.number,
    version: d.version,
    status: d.status,
    sha256: d.sha256,
    createdAt: d.createdAt,
    signedAt: d.signedAt,
    pdfUrl: `/api/documents/${d.id}/pdf`,
    myParty,
    canSign: myParty !== null && d.status === "SIGNING" && !d.signatures.some((s) => s.party === myParty),
    signatures: d.signatures,
  }));
}
