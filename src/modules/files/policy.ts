import type { FilePurpose, Role } from "@/generated/prisma/enums";

/** Что можно загружать по назначению: роли, виды файлов, лимит исходного размера. */
export type Accepts = "image" | "imageOrPdf";

export type PurposePolicy = {
  /** Кто загружает из браузера. Пусто — только сервер (saveFile): ИИ-картинки. */
  roles: readonly Role[];
  accepts: Accepts;
  maxBytes: number;
};

const MB = 1024 * 1024;
/** Исходник с телефона: 3–12 МБ; после сжатия — сотни килобайт. */
const PHOTO_MAX = 25 * MB;

export const PURPOSE_POLICY: Readonly<Record<FilePurpose, PurposePolicy>> = {
  PORTFOLIO: { roles: ["EXECUTOR"], accepts: "image", maxBytes: PHOTO_MAX },
  REQUEST_ROOM: { roles: ["CLIENT"], accepts: "image", maxBytes: PHOTO_MAX },
  STAGE_REPORT: { roles: ["EXECUTOR"], accepts: "image", maxBytes: PHOTO_MAX },
  DISPUTE: { roles: ["CLIENT", "EXECUTOR", "OPERATOR"], accepts: "image", maxBytes: PHOTO_MAX },
  MESSAGE: { roles: ["CLIENT", "EXECUTOR"], accepts: "image", maxBytes: PHOTO_MAX },
  // PDF — только для документов (договоры и акты генерирует documents через saveFile).
  DOCUMENT: { roles: ["OPERATOR"], accepts: "imageOrPdf", maxBytes: 20 * MB },
  VISUALIZATION: { roles: [], accepts: "image", maxBytes: PHOTO_MAX },
};

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;
export const PDF_TYPE = "application/pdf";

/** Заявленный браузером тип: первая проверка. Окончательная — по байтам в finalizeUpload. */
export function declaredTypeAllowed(accepts: Accepts, contentType: string): boolean {
  const type = contentType.toLowerCase();
  if ((IMAGE_TYPES as readonly string[]).includes(type)) return true;
  return accepts === "imageOrPdf" && type === PDF_TYPE;
}

/** Поле-владелец StoredFile → назначение файла, которое к нему прикрепляется. */
export const OWNER_PURPOSE = {
  portfolioItemId: "PORTFOLIO",
  requestId: "REQUEST_ROOM",
  stageId: "STAGE_REPORT",
  disputeId: "DISPUTE",
  messageId: "MESSAGE",
  visualizationId: "VISUALIZATION",
} as const satisfies Record<string, FilePurpose>;

export type OwnerField = keyof typeof OWNER_PURPOSE;
/** Ровно одно поле-владелец. */
export type FileOwner = { [K in OwnerField]: { [P in K]: string } & { [P in Exclude<OwnerField, K>]?: never } }[OwnerField];

