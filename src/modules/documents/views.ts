import type { DocumentKind, DocumentStatus, SignMethod, SignParty } from "@/generated/prisma/enums";
import type { SigningSession } from "./signature";

/** Документ для экрана подписи. Сведения сертификата (ФИО в нём) не отдаются: исполнитель раскрыт только в PDF. */
export type SigningDocumentView = {
  id: string;
  dealId: string;
  stageId: string | null;
  kind: DocumentKind;
  number: string;
  version: number;
  status: DocumentStatus;
  sha256: string;
  createdAt: Date;
  signedAt: Date | null;
  pdfUrl: string;
  /** Сторона текущего пользователя; null — оператор. */
  myParty: SignParty | null;
  canSign: boolean;
  signatures: { party: SignParty; signedAt: Date; signedSha256: string; method: SignMethod }[];
};

export type StartedSigning = SigningSession & {
  /** Для EGOV_QR: QR-код картинкой (data:image/png) — показывать в <img>. */
  qrImage?: string;
  provider: "mock" | "sigex";
};
