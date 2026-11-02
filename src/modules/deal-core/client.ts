// Клиентская точка входа deal-core: только чистые функции без server-only.
// Её можно импортировать из клиентских компонентов и скриптов вне Next (сид).
export { planStages, type PlannedStage, type StageTemplate } from "./stage-plan";
export { daysLeft, plannedReadyAt, type ScheduleInput } from "./schedule";
