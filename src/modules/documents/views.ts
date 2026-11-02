import type { DocumentKind, DocumentStatus, SignMethod, SignParty } from "@/generated/prisma/enums";
import { missingOf, requiredSignatures, type SignedParties, type SigningFlags } from "@/modules/deal-core/client";
import type { SigningSession } from "./signature";

/** Подписи одной стороны на экране: что требуется и что уже есть (время и подписанный хэш). */
export type PartySignaturesView = {
  party: SignParty;
  required: { hand: boolean; ecp: boolean };
  hand: { signedAt: Date; documentSha256: string; typed: boolean } | null;
  ecp: { signedAt: Date; signedSha256: string; method: SignMethod } | null;
};

/**
 * Документ сделки для раздела «Документы» и панели подписи. Сведения сертификата (ФИО в нём) не отдаются:
 * реквизиты мастера раскрыты только в PDF оферты.
 */
export type SigningDocumentView = {
  id: string;
  dealId: string;
  kind: DocumentKind;
  number: string;
  version: number;
  status: DocumentStatus;
  sha256: string;
  createdAt: Date;
  signedAt: Date | null;
  /** Подписанная копия (исходный PDF + лист подписей) — показать в браузере. */
  pdfUrl: string;
  /** Та же копия — скачать файлом. */
  downloadUrl: string;
  /** Исходный файл, хэш которого подписан (без листа подписей). */
  originalPdfUrl: string;
  /** Документ подписывается в приложении (оферта, акт); выписка и расписка — нет. */
  signable: boolean;
  /** Сторона текущего пользователя; null — оператор. */
  myParty: SignParty | null;
  /** Чего не хватает от текущего пользователя, и можно ли подписать сейчас (шаг сделки, версия). */
  canSign: { hand: boolean; ecp: boolean };
  parties: PartySignaturesView[];
};

export type StartedSigning = SigningSession & {
  /** Для EGOV_QR: QR-код картинкой (data:image/png) — показывать в <img>. */
  qrImage?: string;
  provider: "mock" | "sigex";
};

/** Ссылка, чтобы переслать документ: срок ограничен, персональных данных в адресе нет. */
export type SharedLink = { url: string; whatsappUrl: string; expiresAt: Date };

type Row = {
  id: string;
  dealId: string;
  kind: DocumentKind;
  number: string;
  version: number;
  status: DocumentStatus;
  sha256: string;
  createdAt: Date;
  signedAt: Date | null;
  signatures: { party: SignParty; signedAt: Date; signedSha256: string; method: SignMethod }[];
  handSignatures: { party: SignParty; signedAt: Date; documentSha256: string; imageFileId: string | null }[];
};

export const pdfUrls = (id: string) => ({
  pdfUrl: `/api/documents/${id}/pdf`,
  downloadUrl: `/api/documents/${id}/pdf?download=1`,
  originalPdfUrl: `/api/documents/${id}/pdf?original=1`,
});

/** Строка БД → вид для экрана. stepOpen — шаг сделки принимает подпись этого документа сейчас. */
export function toSigningView(row: Row, ctx: { myParty: SignParty | null; flags: SigningFlags; stepOpen: boolean }): SigningDocumentView {
  const have: SignedParties = { hand: row.handSignatures.map((h) => h.party), ecp: row.signatures.map((s) => s.party) };
  const open = ctx.stepOpen && row.status === "SIGNING";
  const missing = missingOf(row.kind, ctx.flags, ctx.myParty, have);
  return {
    id: row.id,
    dealId: row.dealId,
    kind: row.kind,
    number: row.number,
    version: row.version,
    status: row.status,
    sha256: row.sha256,
    createdAt: row.createdAt,
    signedAt: row.signedAt,
    ...pdfUrls(row.id),
    signable: requiredSignatures(row.kind, ctx.flags).length > 0,
    myParty: ctx.myParty,
    canSign: { hand: open && missing.hand, ecp: open && missing.ecp },
    parties: requiredSignatures(row.kind, ctx.flags).map((r) => {
      const hand = row.handSignatures.find((h) => h.party === r.party);
      const ecp = row.signatures.find((s) => s.party === r.party);
      return {
        party: r.party,
        required: { hand: r.hand, ecp: r.ecp },
        hand: hand ? { signedAt: hand.signedAt, documentSha256: hand.documentSha256, typed: hand.imageFileId === null } : null,
        ecp: ecp ? { signedAt: ecp.signedAt, signedSha256: ecp.signedSha256, method: ecp.method } : null,
      };
    }),
  };
}
