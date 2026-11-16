import { to } from "./paths";

/**
 * Экраны v2, уже готовые для оператора (этап 5): на них оператор видит саму страницу v2, на остальных адресах v2 —
 * заглушку «раздел переносится» со ссылкой на тот же экран v1 (`OperatorMoving`). Единственное место этого списка:
 * задача, перенёсшая раздел оператора (Q2–Q5), добавляет сюда его адрес.
 *
 * `exact` — только сам адрес (главная оператора `/v2/operator`: разделы лежат под ней, но ещё не перенесены); без него —
 * адрес и всё под ним целыми сегментами (`/v2/operator/money` и `/v2/operator/money/…`, но не `/v2/operator/moneyx`).
 */
export const OPERATOR_READY: readonly { path: string; exact?: boolean }[] = [
  // Главная оператора и второй шаг входа (Q1).
  { path: to("/operator"), exact: true },
  { path: to("/operator/mfa") },
  // Очереди (Q2): деньги в банке, документы мастеров, отзывы согласий, исполнители (с карточкой и добавлением).
  { path: to("/operator/money") },
  { path: to("/operator/kyc") },
  { path: to("/operator/consents") },
  { path: to("/operator/executors") },
  // Споры и заявки без откликов (Q3): таблица, карточка спора с решением.
  { path: to("/operator/disputes") },
  { path: to("/operator/requests") },
  // Сделки, доход, отчёт и журнал аудита (Q4): таблица и карточка сделки, период дохода, выгрузки CSV, фильтры аудита.
  { path: to("/operator/deals") },
  { path: to("/operator/income") },
  { path: to("/operator/report") },
  { path: to("/operator/audit") },
  // Общие экраны любой роли: профиль (имя, телефон, тема, выход) и уведомления.
  { path: to("/profile"), exact: true },
  { path: to("/notifications") },
];

/** Готов ли экран v2 по этому адресу (путь без строки запроса) для оператора. */
export function isOperatorReady(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return OPERATOR_READY.some((entry) => path === entry.path || (!entry.exact && path.startsWith(`${entry.path}/`)));
}
