import "server-only";

// Публичный API модуля documents: PDF договора и актов, хэши, подпись ЭЦП.
export type * from "./signature";
export type { CompleteSigning, CreateContract, CreateStageAct, CreatedDocument } from "./contracts";
export { signatureProvider } from "./providers";
export {
  completeSigning,
  createContract,
  createStageAct,
  getDocumentPdf,
  listDealDocuments,
  startSigning,
  type SigningDocumentView,
  type StartedSigning,
} from "./service";

export const jobHandlers = {} as const;
