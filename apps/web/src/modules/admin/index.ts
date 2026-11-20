import "server-only";

// Публичный API модуля admin (админка администратора). Каждая функция сама проверяет роль ADMIN и второй фактор.
export { assertAdmin } from "./access";
export { getRecord, listModels, listRecords, PAGE_SIZE, type AdminFieldInfo, type AdminRelation, type RecordsQuery } from "./read";
export { ADMIN_PERIODS, adminStats, isAdminPeriod, type AdminPeriod, type AdminStats, type StatusCount } from "./stats";
export { updateRecord, type FieldChange, type UpdateRecordInput } from "./update";
export { KEY_MAX, type AdminRow, type AdminValue } from "./values";
