// Клиентская точка входа payments (без server-only): чистые формулы денег ТЗ п. 6 для форм.
// Мастер видит «Вы получите после приёмки» по введённой цене до отправки отклика — та же computeDealMoney, что и в сделке.
export { computeDealMoney, kztToTiyn, MAX_PRICE_TIYN, type DealMoney } from "./money";
