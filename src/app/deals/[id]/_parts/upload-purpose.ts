import type { UploadPurpose } from "@/modules/files/client";

/**
 * Назначения фото сделки по ADR-009: сдача (DELIVERY) и «Ход работ» (PROGRESS_REPORT).
 * INTEGRATOR: после слияния tz/platform эти значения есть в UploadPurpose — заменить на литералы
 * (`purpose="DELIVERY"`) и удалить файл. До слияния files отвергает их на сервере понятной ошибкой.
 */
export const DELIVERY_PURPOSE = "DELIVERY" as string as UploadPurpose;
export const PROGRESS_PURPOSE = "PROGRESS_REPORT" as string as UploadPurpose;
