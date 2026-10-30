import "server-only";

// Публичный API модуля files. Другие модули импортируют только отсюда.
export type * from "./storage";
export { fileUrl, storage, storageByName } from "./registry";
export {
  attachFiles,
  createUpload,
  discardUpload,
  finalizeUpload,
  saveFile,
  type CreateUploadInput,
  type CreateUploadResult,
  type UploadedFile,
} from "./upload";
export { findSimilar, type SimilarFile } from "./similar";
export { canReadFile } from "./access";
export { PURPOSE_POLICY, type FileOwner } from "./policy";
export { verifyDownload, openUploadToken } from "./signing";
export { sniffType } from "./image";

export const jobHandlers = {} as const;
