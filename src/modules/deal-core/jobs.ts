import type { JobHandlers } from "@/platform/jobs";

/**
 * Фоновые задачи deal-core. Автоприёмки этапов больше нет (ADR-009): статус двигают итоги операций журнала,
 * а их исполнение и опрос — задачи payments (src/jobs.ts собирает их с хуком onMoneySettled).
 */
export const jobHandlers = {} as const satisfies JobHandlers;
