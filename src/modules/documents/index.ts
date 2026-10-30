import "server-only";

// Публичный API модуля documents: PDF договора и актов, хэши, подпись ЭЦП.
export type * from "./signature";
export type { CompleteSigning, CreateContract, CreateStageAct, CreatedDocument } from "./contracts";
export { signatureProvider } from "./providers";
export { completeSigning, createContract, createStageAct, getDocumentPdf, listDealDocuments, startSigning } from "./service";
export type { SigningDocumentView, StartedSigning } from "./views";

export const jobHandlers = {} as const;
