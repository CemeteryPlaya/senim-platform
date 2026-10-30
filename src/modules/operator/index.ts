import "server-only";

// Публичный API модуля operator. Каждая функция сервиса проверяет роль OPERATOR сама;
// экраны дополнительно вызывают requireUser("OPERATOR"). Демо-функции — только при DEMO_MODE.
export { isDemoMode } from "./access";
export { searchAudit } from "./audit-log";
export type { AuditView } from "./audit-view";
export { getBankDemo, type BankDemo } from "./bank-demo";
export { getPaymentRailSetting, PAYMENTS_RAIL_SETTING, resetDemoData, setPaymentRail } from "./demo";
export { getDisputeCard, listDisputes, resolveDispute } from "./disputes";
export { addExecutor, changeSegment, getExecutorCard, listExecutors, listRegistrationQueue, reviewRegistration } from "./executors";
export { addFurnitureType, listFurnitureTypes, moveFurnitureType, renameFurnitureType, setFurnitureTypeActive } from "./furniture-types";
export { buildCsv, buildReport, type EscrowReconciliation, type StatusTotal } from "./report";
export { listStaleRequests } from "./requests";
export type { Persona, ScenarioStep, ScenarioStepKey } from "./scenario";
export * from "./schemas";

export const jobHandlers = {} as const;
