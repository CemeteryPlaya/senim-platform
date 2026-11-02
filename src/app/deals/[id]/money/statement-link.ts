/**
 * Ссылка «Печатаемая выписка (PDF)». Пока documents не выпускает MONEY_STATEMENT, ведёт на печатную страницу
 * выписки (печать или «Сохранить как PDF» в браузере) — те же строки журнала.
 * INTEGRATOR: когда documents даст PDF выписки (например, `/api/documents/statement/<dealId>` или id документа
 * MONEY_STATEMENT), вернуть здесь его адрес и удалить ./statement/.
 */
export const statementHref = (dealId: string): string => `/deals/${dealId}/money/statement`;
