import QRCode from "qrcode";
import type { DocumentKind, DocumentStatus, SignMethod, SignParty } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { recordAudit, requestOrigin } from "@/modules/audit";
import { isFullySigned, isSignable, missingOf, onDocumentSigned, signingFlags, type SignedParties } from "@/modules/deal-core";
import { actorOf, type CurrentUser } from "@/modules/identity";
import { notify } from "@/modules/notifications";
import { decryptPii, hashPii, last4 } from "@/platform/crypto";
import { db, isUniqueViolation, transaction, type Db, type Tx } from "@/platform/db";
import { expectOneUpdated, fail } from "@/platform/errors";
import { enqueueJob } from "@/platform/jobs";
import { canRead, partyOf } from "./access";
import { EMAIL_ACT_JOB } from "./email";
import { assertHandImage, storeHandImage } from "./hand-image";
import { lockDeal, scopeOf } from "./issue";
import { signatureProvider } from "./providers";
import type { StartedSigning } from "./views";

const t = ru.documents;

// ─── доступ и шаг сделки ────────────────────────────────────────────────────

function loadDocument(client: Db, documentId: string) {
  return client.document.findUnique({
    where: { id: documentId },
    include: {
      deal: { select: { id: true, clientId: true, executor: { select: { userId: true } } } },
      signatures: { select: { party: true } },
      handSignatures: { select: { party: true } },
    },
  });
}

type LoadedDocument = NonNullable<Awaited<ReturnType<typeof loadDocument>>>;

const signedParties = (doc: { signatures: { party: SignParty }[]; handSignatures: { party: SignParty }[] }): SignedParties => ({
  hand: doc.handSignatures.map((s) => s.party),
  ecp: doc.signatures.map((s) => s.party),
});

/** Документ, который пользователь вправе видеть; иначе «не найден» (не раскрываем, что он существует). */
export async function readableDocument(user: CurrentUser, documentId: string): Promise<LoadedDocument> {
  const doc = await loadDocument(db, documentId);
  if (!doc || !canRead(user, doc.deal)) return fail.notFound(t.errors.notFound);
  return doc;
}

/**
 * Шаг сделки принимает подпись документа: оферту — пока сделка CREATED и оферта не заключена;
 * акт — пока сделка READY и спор не открыт (открытый спор замораживает все переходы, ADR-009 раздел 3).
 */
export async function dealAcceptsSignature(client: Db, dealId: string, kind: DocumentKind): Promise<boolean> {
  const deal = await client.deal.findUniqueOrThrow({
    where: { id: dealId },
    select: { status: true, signedAt: true, disputes: { where: { status: "OPEN" }, select: { id: true }, take: 1 } },
  });
  if (kind === "CONTRACT") return deal.status === "CREATED" && deal.signedAt === null;
  if (kind === "ACCEPTANCE_ACT") return deal.status === "READY" && deal.disputes.length === 0;
  return false;
}

function assertOpen(status: DocumentStatus) {
  if (status === "SUPERSEDED") fail.conflict(t.errors.superseded);
  if (status === "SIGNED") fail.conflict(t.errors.alreadySigned);
}

/** Сторона, которая может подписать документ: сторона сделки, документ подписывается, версия действует. */
async function signerOf(user: CurrentUser, documentId: string): Promise<{ doc: LoadedDocument; party: SignParty }> {
  const doc = await readableDocument(user, documentId);
  const party = partyOf(user, doc.deal);
  if (!party) return fail.forbidden(t.errors.operatorCannotSign);
  if (!isSignable(doc.kind)) return fail.conflict(t.errors.notSignableKind);
  assertOpen(doc.status);
  return { doc, party };
}

/**
 * Под блокировкой сделки и строки документа — повторная проверка всего, что могло измениться
 * между нажатием и записью: версия, статус, шаг сделки, подписи (двойной клик, вторая вкладка).
 */
async function lockedState(tx: Tx, doc: LoadedDocument) {
  // Порядок блокировок как в issue.ts и deal-core: сначала сделка, потом документ.
  await lockDeal(tx, doc.dealId);
  const [locked] = await tx.$queryRaw<{ status: DocumentStatus; sha256: string }[]>`
    SELECT status, sha256 FROM "Document" WHERE id = ${doc.id} FOR UPDATE`;
  const fresh = await loadDocument(tx, doc.id);
  if (!locked || !fresh) return fail.notFound(t.errors.notFound);
  assertOpen(locked.status);
  if (locked.sha256 !== doc.sha256) fail.conflict(t.errors.superseded);
  if (!(await dealAcceptsSignature(tx, doc.dealId, doc.kind))) fail.conflict(t.errors.dealNotSignable);
  return { sha256: locked.sha256, have: signedParties(fresh) };
}

// ─── полностью подписан ─────────────────────────────────────────────────────

/**
 * После каждой подписи (в той же транзакции): все требуемые подписи есть — документ SIGNED,
 * deal-core.onDocumentSigned (оферта заключена / акт → ACCEPTED и выплата), письмо с актом обеим сторонам.
 * Иначе, если сторона поставила все свои подписи, — уведомление второй стороне.
 */
async function afterSignature(tx: Tx, doc: LoadedDocument, user: CurrentUser, party: SignParty): Promise<{ fullySigned: boolean }> {
  const fresh = await loadDocument(tx, doc.id);
  if (!fresh) return fail.notFound(t.errors.notFound);
  const have = signedParties(fresh);
  const flags = signingFlags();
  const kind = t.kinds[doc.kind];
  const otherUserId = party === "CLIENT" ? doc.deal.executor.userId : doc.deal.clientId;
  const link = `/deals/${doc.dealId}`;

  if (!isFullySigned(doc.kind, flags, have)) {
    const mine = missingOf(doc.kind, flags, party, have);
    if (!mine.hand && !mine.ecp) {
      await notify(tx, { userId: otherUserId, kind: "document.signed_by_party", title: t.notify.signedByParty.title(kind), body: t.notify.signedByParty.body(doc.number), link });
    }
    return { fullySigned: false };
  }

  expectOneUpdated(await tx.document.updateMany({ where: { id: doc.id, status: "SIGNING" }, data: { status: "SIGNED", signedAt: new Date() } }));
  await recordAudit(tx, {
    actor: actorOf(user),
    action: "document.signed",
    entity: { type: "document", id: doc.id },
    scope: scopeOf(doc.dealId),
    before: { status: "SIGNING" },
    after: { status: "SIGNED", sha256: doc.sha256 },
  });
  await notify(tx, { userId: otherUserId, kind: "document.fully_signed", title: t.notify.fullySigned.title(kind), body: t.notify.fullySigned.body(doc.number), link });
  await onDocumentSigned(tx, doc.id);
  if (doc.kind === "ACCEPTANCE_ACT") await enqueueJob(tx, { kind: EMAIL_ACT_JOB, payload: { documentId: doc.id }, dedupeKey: `${EMAIL_ACT_JOB}:${doc.id}` });
  return { fullySigned: true };
}

// ─── собственноручная подпись ───────────────────────────────────────────────

export type HandSignatureInput = { documentId: string } & ({ image: Uint8Array; typedName?: undefined } | { typedName: string; image?: undefined });

/**
 * Собственноручная подпись (решение 2.2.4 а): рисунок PNG с холста или напечатанное имя (клавиатурная
 * альтернатива). Сохраняется хэш документа на момент подписи, время, IP и устройство. Двойной клик —
 * одна подпись: под блокировкой вторая попытка видит готовую подпись (и уникальный индекс documentId+party).
 */
export async function signByHand(user: CurrentUser, input: HandSignatureInput): Promise<{ fullySigned: boolean }> {
  const typedName = input.typedName?.trim();
  if (input.image) await assertHandImage(input.image);
  else if (!typedName || typedName.length < 2 || typedName.length > 120) fail.validation(t.errors.typedNameLength);

  const { doc, party } = await signerOf(user, input.documentId);
  if (!missingOf(doc.kind, signingFlags(), party, { hand: [], ecp: [] }).hand) fail.conflict(t.errors.handNotRequired);
  const origin = await requestOrigin();

  return transaction(async (tx) => {
    const { sha256, have } = await lockedState(tx, doc);
    if (have.hand.includes(party)) fail.conflict(t.errors.alreadySignedByYou);
    const image = input.image ? await storeHandImage(tx, input.image, user.id) : null;
    try {
      await tx.handSignature.create({
        data: { documentId: doc.id, userId: user.id, party, imageFileId: image?.id ?? null, typedName: image ? null : typedName, documentSha256: sha256, ip: origin.ip, userAgent: origin.userAgent },
      });
    } catch (e) {
      if (isUniqueViolation(e)) fail.conflict(t.errors.alreadySignedByYou);
      throw e;
    }
    await recordAudit(tx, {
      actor: actorOf(user),
      action: "document.hand_signature.added",
      entity: { type: "document", id: doc.id },
      scope: scopeOf(doc.dealId),
      after: { party, kind: image ? "image" : "typed", documentSha256: sha256 },
      origin,
    });
    return afterSignature(tx, doc, user, party);
  });
}

// ─── ЭЦП ────────────────────────────────────────────────────────────────────

type SignerSource = { fullName: string | null; iinEnc: string | null; iinHash: string | null };

/**
 * Подписант мастера — свойство профиля (ADR-003): ТОО — директор своим сертификатом (ИИН директора
 * из профиля, signerIin*); ИП и самозанятый — владелец (ИИН профиля, binIin*).
 * TODO(ТОО): сверять и БИН организации из сертификата юрлица, когда провайдер станет его возвращать.
 */
function executorSigner(p: { legalForm: string; legalName: string; signerFullName: string | null; signerIinEnc: string | null; signerIinHash: string | null; binIinEnc: string; binIinHash: string | null }): SignerSource {
  const fullName = p.signerFullName ?? (p.legalForm === "TOO" ? null : p.legalName);
  return p.legalForm === "TOO" ? { fullName, iinEnc: p.signerIinEnc, iinHash: p.signerIinHash } : { fullName, iinEnc: p.binIinEnc, iinHash: p.binIinHash };
}

/** Кто обязан подписать ЭЦП за сторону: сверяется HMAC полного ИИН сертификата с ИИН стороны. */
async function expectedSigner(userId: string, party: SignParty): Promise<{ fullName: string; iin: string; iinHash: string }> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      fullName: true,
      iinEnc: true,
      iinHash: true,
      executorProfile: { select: { legalForm: true, legalName: true, signerFullName: true, signerIinEnc: true, signerIinHash: true, binIinEnc: true, binIinHash: true } },
    },
  });
  const signer = party === "EXECUTOR" && user.executorProfile ? executorSigner(user.executorProfile) : user;
  if (!signer.iinEnc || !signer.iinHash) return fail.validation(t.errors.signerIinMissing);
  return { fullName: signer.fullName ?? "", iin: decryptPii(signer.iinEnc), iinHash: signer.iinHash };
}

/** Начать подпись ЭЦП стороной сделки. Подписывается sha256 PDF, сохранённый в Document. */
export async function startSigning(user: CurrentUser, documentId: string, method: SignMethod): Promise<StartedSigning> {
  const { doc, party } = await signerOf(user, documentId);
  if (!missingOf(doc.kind, signingFlags(), party, signedParties(doc)).ecp) fail.conflict(t.errors.alreadySignedByYou);
  // Шаг сделки не тот (отменена, ещё не сдана): сессию у провайдера (QR eGov Mobile) не открываем.
  if (!(await dealAcceptsSignature(db, doc.dealId, doc.kind))) fail.conflict(t.errors.dealNotSignable);
  const { fullName, iin } = await expectedSigner(user.id, party);
  const provider = signatureProvider();
  const session = await provider.startSigning({ documentId, description: t.signingDescription(t.kinds[doc.kind], doc.number), sha256: doc.sha256, method, signer: { userId: user.id, fullName, iin } });
  await recordAudit(db, { actor: actorOf(user), action: "document.signing.started", entity: { type: "document", id: documentId }, scope: scopeOf(doc.dealId), meta: { method, provider: provider.name } });
  const qrImage = session.qrPayload ? await QRCode.toDataURL(session.qrPayload, { margin: 1, width: 288 }) : undefined;
  return { ...session, qrImage, provider: provider.name };
}

/**
 * Завершить подпись ЭЦП: сервер сам берёт CMS у провайдера и проверяет её (verify) против хэша документа.
 * Подпись сохраняется только при valid, совпадении sha256 и ИИН подписанта. Двойное нажатие — одна запись.
 * Документ подписан полностью — deal-core.onDocumentSigned в той же транзакции.
 */
export async function completeSigning(user: CurrentUser, input: { documentId: string; sessionId: string }): Promise<{ fullySigned: boolean }> {
  const { doc, party } = await signerOf(user, input.documentId);
  const provider = signatureProvider();

  const result = await provider.getResult(input.sessionId);
  if (result.status === "pending") return fail.conflict(t.errors.pending);
  if (result.status === "failed") return fail.validation(t.errors.rejected(result.error));

  const verified = await provider.verify({ cms: result.cms, sha256: doc.sha256 });
  if (!verified.valid) return fail.validation(t.errors.rejected(verified.reason));
  const { certIin } = verified;
  const expected = await expectedSigner(user.id, party);
  if (!certIin || hashPii(certIin) !== expected.iinHash) return fail.validation(t.errors.otherSigner);

  return transaction(async (tx) => {
    const { sha256, have } = await lockedState(tx, doc);
    if (have.ecp.includes(party)) fail.conflict(t.errors.alreadySignedByYou);
    try {
      await tx.signature.create({
        data: {
          documentId: doc.id,
          userId: user.id,
          party,
          method: result.method,
          signedSha256: sha256,
          signature: result.cms,
          certSubject: verified.certSubject,
          certSerial: verified.certSerial,
          certIinLast4: last4(certIin),
          verified: true,
          signedAt: verified.signedAt,
        },
      });
    } catch (e) {
      if (isUniqueViolation(e)) fail.conflict(t.errors.alreadySignedByYou);
      throw e;
    }
    await recordAudit(tx, {
      actor: actorOf(user),
      action: "document.signature.added",
      entity: { type: "document", id: doc.id },
      scope: scopeOf(doc.dealId),
      after: { party, method: result.method, signedSha256: sha256, certSerial: verified.certSerial },
    });
    return afterSignature(tx, doc, user, party);
  });
}
