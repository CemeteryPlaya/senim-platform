/**
 * Когда и как предлагать установку приложения на телефон. Чистые функции: состояние браузера
 * (user agent, display-mode, событие beforeinstallprompt, localStorage) передаётся параметрами.
 */

/**
 * prompt — Chrome, Edge, Samsung Internet прислали beforeinstallprompt; ios-hint — подсказка про «Поделиться»;
 * open-in-browser — встроенный браузер (Instagram, Telegram): установить можно только из Safari или Chrome.
 */
export type InstallMethod = "prompt" | "ios-hint" | "open-in-browser" | "none";

/**
 * iPhone и iPad: добавить на экран «Домой» можно из меню «Поделиться» (Safari, а с iOS 16.4 и Chrome).
 * iPadOS представляется как Mac — отличаем по сенсорному экрану. Встроенные браузеры приложений
 * (Instagram, Telegram) не пишут «Safari/» в user agent, и пункта «На экран „Домой“» у них нет.
 */
export function canAddToHomeScreenOnIos(userAgent: string, maxTouchPoints: number): boolean {
  return isAppleMobile(userAgent, maxTouchPoints) && /Safari\//.test(userAgent);
}

/** iPhone, iPad (iPadOS представляется как Mac — отличаем по сенсорному экрану), iPod. */
export function isAppleMobile(userAgent: string, maxTouchPoints: number): boolean {
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

/** Уже открыто как установленное приложение. navigator.standalone — только у iOS. */
export function isStandalone(state: { displayModeStandalone: boolean; navigatorStandalone: boolean | undefined }): boolean {
  return state.displayModeStandalone || state.navigatorStandalone === true;
}

/**
 * Встроенный браузер приложения (Instagram, Facebook, Telegram, WebView Android): в нём нет ни
 * beforeinstallprompt, ни «На экран „Домой“». На iPhone это любой браузер без «Safari/» в user agent.
 */
export function isInAppBrowser(userAgent: string, maxTouchPoints: number): boolean {
  if (/Instagram|FBAN|FBAV|FB_IAB|Telegram|Snapchat|musical_ly|TikTok|; wv\)/i.test(userAgent)) return true;
  return isAppleMobile(userAgent, maxTouchPoints) && !/Safari\//.test(userAgent);
}

export function installMethod(state: { standalone: boolean; promptReady: boolean; ios: boolean; inApp: boolean }): InstallMethod {
  if (state.standalone) return "none";
  if (state.promptReady) return "prompt";
  if (state.ios) return "ios-hint";
  return state.inApp ? "open-in-browser" : "none";
}

/** Плашка на главной закрывается «Скрыть». */
export function showBanner(method: InstallMethod, dismissed: boolean): boolean {
  return method !== "none" && !dismissed;
}

/** Пункт в шапке остаётся всегда, пока установить можно: «Скрыть» у плашки его не касается. */
export function showHeaderItem(method: InstallMethod): boolean {
  return method !== "none";
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
