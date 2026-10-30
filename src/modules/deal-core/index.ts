import "server-only";

// Публичный API ядра сделки. Ядро не знает про мебель: шаблоны этапов приходят из вертикали.
export { planStages, type PlannedStage, type StageTemplate } from "./stage-plan";

export const jobHandlers = {} as const;
