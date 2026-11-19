import "server-only";

// Публичный API модуля admin (админка администратора). Каждая функция сама проверяет роль ADMIN и второй фактор.
export { assertAdmin } from "./access";
export { getRecord, listModels, listRecords, PAGE_SIZE, type AdminFieldInfo, type AdminRelation, type RecordsQuery } from "./read";
export type { AdminRow, AdminValue } from "./values";
