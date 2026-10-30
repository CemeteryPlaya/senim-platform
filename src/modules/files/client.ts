// Клиентская точка входа модуля files: только типы, без серверного кода.
export type { UploadTarget } from "./storage";

/** Назначения, которые загружаются из браузера (DOCUMENT — оператор, VISUALIZATION — только сервер). */
export type UploadPurpose = "PORTFOLIO" | "REQUEST_ROOM" | "STAGE_REPORT" | "DISPUTE" | "MESSAGE" | "DOCUMENT";
