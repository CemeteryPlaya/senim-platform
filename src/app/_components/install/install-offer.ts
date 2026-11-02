/**
 * Когда и как предлагать установку приложения на телефон. Чистые функции: состояние браузера
 * (user agent, display-mode, событие beforeinstallprompt, localStorage) передаётся параметрами.
 */

/** prompt — Chrome, Edge, Samsung Internet прислали beforeinstallprompt; ios-hint — подсказка про «Поделиться». */
export type InstallMethod = "prompt" | "ios-hint" | "none";

/**
 * iPhone и iPad: добавить на экран «Домой» можно из меню «Поделиться» (Safari, а с iOS 16.4 и Chrome).
 * iPadOS представляется как Mac — отличаем по сенсорному экрану. Встроенные браузеры приложений
 * (Instagram, Telegram) не пишут «Safari/» в user agent, и пункта «На экран „Домой“» у них нет.
 */
export function canAddToHomeScreenOnIos(userAgent: string, maxTouchPoints: number): boolean {
  const apple = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  return apple && /Safari\//.test(userAgent);
}

/** Уже открыто как установленное приложение. navigator.standalone — только у iOS. */
export function isStandalone(state: { displayModeStandalone: boolean; navigatorStandalone: boolean | undefined }): boolean {
  return state.displayModeStandalone || state.navigatorStandalone === true;
}

export function installMethod(state: { standalone: boolean; promptReady: boolean; ios: boolean }): InstallMethod {
  if (state.standalone) return "none";
  if (state.promptReady) return "prompt";
  return state.ios ? "ios-hint" : "none";
}

/** Плашка на главной закрывается «Скрыть»; пункт в меню остаётся всегда, пока установить можно. */
export function showBanner(method: InstallMethod, dismissed: boolean): boolean {
  return method !== "none" && !dismissed;
}

export const DISMISS_KEY = "senim.install.dismissed";

type KeyValue = { getItem(key: string): string | null; setItem(key: string, value: string): void };

/** Доступ к localStorage бросает исключение в приватном режиме и при запрете хранения — тогда «не скрывали». */
export function readDismissed(storage: () => KeyValue): boolean {
  try {
    return storage().getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveDismissed(storage: () => KeyValue): void {
  try {
    storage().setItem(DISMISS_KEY, "1");
  } catch {
    // Не запомнили — плашка вернётся при следующем заходе; это не ошибка для пользователя.
  }
}
