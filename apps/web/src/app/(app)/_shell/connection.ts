/**
 * Когда обновлять данные экрана при возврате в приложение (вкладка снова видна, PWA вернули из фона). Чистые функции:
 * время и состояние сети передаются аргументами.
 */

/** Сколько экран должен пробыть скрытым, чтобы при возврате его стоило перечитать, и не чаще какого шага обновлять. */
export const RETURN_REFRESH_MS = 30_000;

export type ReturnState = {
  /** Когда экран скрылся (`visibilitychange` → hidden); `null` — не скрывался. */
  hiddenAt: number | null;
  /** Когда экран обновлялся в последний раз (загрузка, возврат, восстановление связи). */
  refreshedAt: number;
};

/**
 * Перечитать ли экран сейчас, когда он снова виден: был скрыт не меньше `RETURN_REFRESH_MS` (мастер мог принять работу,
 * пока телефон лежал), с прошлого обновления прошло столько же (частые переключения вкладок не дёргают сервер), и сеть
 * есть (без сети обновит возврат связи).
 */
export function shouldRefreshOnReturn(state: ReturnState, now: number, online: boolean): boolean {
  if (!online || state.hiddenAt === null) return false;
  return now - state.hiddenAt >= RETURN_REFRESH_MS && now - state.refreshedAt >= RETURN_REFRESH_MS;
}

/** Связь вернулась после обрыва — экран перечитывается сразу (данные могли устареть, а отправки — не дойти). */
export function shouldRefreshOnReconnect(wasOnline: boolean, online: boolean): boolean {
  return !wasOnline && online;
}
