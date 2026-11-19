// Клиентская точка входа модуля files: только типы, без серверного кода.
import type { FilePurpose } from "@/generated/prisma/enums";

export type { UploadTarget } from "./storage";

/** Назначения, которые загружаются из браузера (VISUALIZATION создаёт только сервер). */
export type UploadPurpose = Exclude<FilePurpose, "VISUALIZATION">;

/** Файл для экрана (фото или PDF) — вид, который отдаёт `fileViews`. */
export type { FileView } from "./views";
