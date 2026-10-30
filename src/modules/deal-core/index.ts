import "server-only";

// Публичный API ядра сделки. Ядро не знает про мебель: шаблоны этапов приходят из вертикали.
// Контракты для других модулей (createDeal, onDocumentSigned, resolveDispute) — в ./contracts.
export { planStages, type PlannedStage, type StageTemplate } from "./stage-plan";
export type { CreateDeal, CreateDealInput, OnDocumentSigned, ResolveDispute, ResolveDisputeInput } from "./contracts";

export const jobHandlers = {} as const;
