import type { FilePurpose, Role } from "@/generated/prisma/enums";

/** Что можно загружать: фото, фото или PDF, только PNG (рисунок подписи — с прозрачным фоном). */
export type Accepts = "image" | "imageOrPdf" | "png";

/** Поля-владельцы StoredFile: файл прикрепляется к сущности записью id в одно из них (attachFiles). */
export type OwnerField =
  | "portfolioItemId"
  | "requestId"
  | "progressReportId"
  | "dealId"
  | "executorProfileId"
  | "disputeId"
  | "messageId"
  | "visualizationId";

/**
 * Куда прикрепляется файл: поле-владелец StoredFile (attachFiles) или ссылка с другой стороны —
 * уникальный внешний ключ чужой таблицы (Document.fileId, MoneyTransaction.bankDocFileId,
 * HandSignature.imageFileId). Такую ссылку пишет модуль-владелец после assertAttachable.
 */
export type AttachTo = { owner: OwnerField } | { linkedBy: "Document" | "MoneyTransaction" | "HandSignature" };

export type PurposePolicy = {
  /** Кто загружает из браузера. Пусто — только сервер (saveFile): ИИ-картинки. */
  roles: readonly Role[];
  accepts: Accepts;
  maxBytes: number;
  attachTo: AttachTo;
  /**
   * Ссылка на скачивание живёт 15 минут (иначе час): файлы сделки, споров, чата, документы и KYC —
   * пересланная ссылка быстро перестаёт работать. Портфолио, фото помещения и визуализации видит больше людей.
   */
  shortLink: boolean;
};

const MB = 1024 * 1024;
/** Исходник с телефона: 3–12 МБ; после сжатия — сотни килобайт. */
const PHOTO_MAX = 25 * MB;
const PDF_MAX = 20 * MB;

/** Одно место для всех правил назначения: права загрузки, виды файлов, лимит и владелец. */
export const PURPOSE_POLICY: Readonly<Record<FilePurpose, PurposePolicy>> = {
  PORTFOLIO: { roles: ["EXECUTOR"], accepts: "image", maxBytes: PHOTO_MAX, attachTo: { owner: "portfolioItemId" }, shortLink: false },
  // Фото помещения — заказчик в мастере и замерщик площадки (ADR-005).
  REQUEST_ROOM: { roles: ["CLIENT", "MEASURER"], accepts: "image", maxBytes: PHOTO_MAX, attachTo: { owner: "requestId" }, shortLink: false },
  // «Ход работ» и фото сдачи (READY) — мастер сделки; прикрепляет deal-core после своей проверки сторон.
  PROGRESS_REPORT: { roles: ["EXECUTOR"], accepts: "image", maxBytes: PHOTO_MAX, attachTo: { owner: "progressReportId" }, shortLink: true },
  DELIVERY: { roles: ["EXECUTOR"], accepts: "image", maxBytes: PHOTO_MAX, attachTo: { owner: "dealId" }, shortLink: true },
  DISPUTE: { roles: ["CLIENT", "EXECUTOR", "OPERATOR"], accepts: "image", maxBytes: PHOTO_MAX, attachTo: { owner: "disputeId" }, shortLink: true },
  MESSAGE: { roles: ["CLIENT", "EXECUTOR"], accepts: "image", maxBytes: PHOTO_MAX, attachTo: { owner: "messageId" }, shortLink: true },
  // PDF — только для документов (договоры и акты генерирует documents через saveFile).
  DOCUMENT: { roles: ["OPERATOR"], accepts: "imageOrPdf", maxBytes: PDF_MAX, attachTo: { linkedBy: "Document" }, shortLink: true },
  VISUALIZATION: { roles: [], accepts: "image", maxBytes: PHOTO_MAX, attachTo: { owner: "visualizationId" }, shortLink: false },
  // KYC: фото удостоверения и свидетельство ИП/ТОО (с eGov оно приходит PDF) — сам мастер в свой профиль.
  KYC_ID: { roles: ["EXECUTOR"], accepts: "imageOrPdf", maxBytes: PDF_MAX, attachTo: { owner: "executorProfileId" }, shortLink: true },
  KYC_REGISTRATION: { roles: ["EXECUTOR"], accepts: "imageOrPdf", maxBytes: PDF_MAX, attachTo: { owner: "executorProfileId" }, shortLink: true },
  // Скан банковского документа (manual): только оператор; к операции его приложит payments.
  BANK_DOCUMENT: { roles: ["OPERATOR"], accepts: "imageOrPdf", maxBytes: PDF_MAX, attachTo: { linkedBy: "MoneyTransaction" }, shortLink: true },
  // Рисунок подписи: PNG с прозрачным фоном — его встраивают в PDF; загружает сторона документа.
  HAND_SIGNATURE: { roles: ["CLIENT", "EXECUTOR"], accepts: "png", maxBytes: 2 * MB, attachTo: { linkedBy: "HandSignature" }, shortLink: true },
};

// HEIC/HEIF — фото iPhone и части Android: сервер раскодирует их сам (image.ts, decodeHeif).
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"] as const;
export const PDF_TYPE = "application/pdf";
export const PNG_TYPE = "image/png";

/** Заявленный браузером тип: первая проверка. Окончательная — по байтам в finalizeUpload. */
export function declaredTypeAllowed(accepts: Accepts, contentType: string): boolean {
  const type = contentType.toLowerCase();
  if (accepts === "png") return type === PNG_TYPE;
  if ((IMAGE_TYPES as readonly string[]).includes(type)) return true;
  return accepts === "imageOrPdf" && type === PDF_TYPE;
}

/** Назначения, которые прикрепляются к полю-владельцу (у KYC-профиля их два). */
export function purposesOf(field: OwnerField): FilePurpose[] {
  return (Object.entries(PURPOSE_POLICY) as [FilePurpose, PurposePolicy][]).flatMap(([purpose, p]) =>
    "owner" in p.attachTo && p.attachTo.owner === field ? [purpose] : [],
  );
}

/** Ровно одно поле-владелец. */
export type FileOwner = { [K in OwnerField]: { [P in K]: string } & { [P in Exclude<OwnerField, K>]?: never } }[OwnerField];
