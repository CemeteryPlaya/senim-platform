import "server-only";

// Публичный API модуля operator. Каждая функция сервиса проверяет роль OPERATOR сама;
// экраны дополнительно вызывают requireUser("OPERATOR"). Демо-функции — только при DEMO_MODE.
export { isDemoMode } from "./access";
export { searchAudit } from "./audit-log";
export type { AuditView } from "./audit-view";
export { getBankDemo, type BankDemo } from "./bank-demo";
export { getOperatorDeal, listOperatorDeals, type DealDocument, type JournalRow, type OperatorDeal, type OperatorDealRow, type ReleasePackage } from "./deals";
export { resetDemoData } from "./demo";
export { getDisputeCard, listDisputes, previewDisputeSplit, resolveDispute } from "./disputes";
export { addExecutor, changeSegment, getExecutorCard, listExecutors, listRegistrationQueue, reviewRegistration } from "./executors";
export { addFurnitureType, listFurnitureTypes, moveFurnitureType, renameFurnitureType, setFurnitureTypeActive } from "./furniture-types";
export { kycQueue, kycReviewSchema, reviewKyc, type KycDocument, type KycQueueItem, type KycReviewInput } from "./kyc";
export { confirmBankOperation, failBankOperation, isManualType, listMoneyQueue, saveBankDocument, type ManualOperationType, type MoneyQueueItem } from "./money";
export { buildCsv, buildIncomeCsv, buildReport, incomeReport, type OperationTotal, type StatusTotal } from "./report";
export { addMaterialPrice, changeMaterialPrice, listMaterialPrices, setMaterialPriceActive, type MaterialPriceRow } from "./material-prices";
export { listStaleRequests } from "./requests";
export type { Persona, ScenarioStep, ScenarioStepKey } from "./scenario";
export { platformSettings, type PlatformSettings } from "./settings";
export * from "./schemas";

export const jobHandlers = {} as const;
