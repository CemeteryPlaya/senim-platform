import { ru } from "@/i18n/ru";

/** Таблицы статусов на экране статистики. */
export type StatusTableKind = "requests" | "deals" | "masters";

/** Подписи — те же, что у сотрудников площадки: заявки — общие тексты заявок, сделки и регистрация мастера — тексты оператора. */
const LABELS: Record<StatusTableKind, Record<string, string>> = {
  requests: ru.requests.status,
  deals: ru.app.operatorDeals.dealStatus,
  masters: ru.app.operatorQueues.registration,
};

/** Статус по-русски; неизвестный (новое значение в базе раньше текста) — как есть. */
export function statusLabel(kind: StatusTableKind, status: string): string {
  return LABELS[kind][status] ?? status;
}
