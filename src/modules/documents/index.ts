import "server-only";
import type { DocumentsPort } from "@/modules/deal-core";
import { createAcceptanceAct, createContract } from "./issue";
import { createEmailSignedActHandler, emailProvider, EMAIL_ACT_JOB, partyEmail } from "./email";
import { signedCopyForEmail } from "./read";

// Публичный API модуля documents: оферта, акт приёмки, выписка, расписка (PDF и версии), подписи
// (собственноручная и ЭЦП), подписанные ссылки и отправка акта на e-mail.
export type * from "./signature";
export type { CompleteSigning, CreateAcceptanceAct, CreateContract, CreatedDocument } from "./contracts";
export { signatureProvider } from "./providers";
export { createAcceptanceAct, createAcceptanceActIssuedAt, createContract, createContractIssuedAt, ensureMoneyStatement, withdrawContract } from "./issue";
export { completeSigning, signByHand, startSigning, type HandSignatureInput } from "./signing";
export {
  createReleaseReceipt,
  getDocumentPdf,
  getSharedDocumentPdf,
  LINK_TTL_HOURS,
  listDealDocuments,
  openSharedDocument,
  shareDocument,
  type PdfVariant,
  type SharedDocumentView,
} from "./read";
export { HAND_IMAGE_MAX_BYTES } from "./hand-image";
export { requiredSignatures, isFullySigned, type Requirement } from "./requirements";
export type { PartySignaturesView, SharedLink, SigningDocumentView, StartedSigning } from "./views";

/** Реализация порта документов deal-core: регистрируется в src/instrumentation.ts (и в точках сборки задач и сида). */
export const documentsPort: DocumentsPort = { createContract, createAcceptanceAct };

export const jobHandlers = {
  [EMAIL_ACT_JOB]: createEmailSignedActHandler({ provider: emailProvider, emailOf: partyEmail, signedCopy: signedCopyForEmail }),
} as const;
