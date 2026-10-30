/**
 * Зависимости deal-core от других модулей — в одном месте.
 *
 * Направление импортов: deal-core → documents и deal-core → companies. Обратных импортов нет:
 * documents получает deal-core.onDocumentSigned как хук (completeSigning(..., { onFullySigned })),
 * который передаёт экран (_components/signing), поэтому цикла не возникает и регистрация не нужна.
 */
export { createContract, createStageAct, withdrawContract } from "@/modules/documents";
export { maskContacts, recalculateRating, sanitizeExecutorText } from "@/modules/companies";
