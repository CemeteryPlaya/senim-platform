import { useSyncExternalStore } from "react";
import { canAddToHomeScreenOnIos, installMethod, isInAppBrowser, isStandalone, readDismissed, saveDismissed, type InstallMethod } from "./install-offer";

/**
 * Состояние установки в браузере — одно на страницу: событие beforeinstallprompt приходит один раз,
 * а предложить установку могут и пункт меню, и плашка на главной. Модуль подписывается на событие
 * при первом импорте (его импортирует PwaSetup из корневого layout), поэтому событие не теряется,
 * даже если меню ещё не открыто.
 */
type BeforeInstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

const STANDALONE_QUERY = "(display-mode: standalone)";

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    // Без preventDefault Chrome сам покажет свою плашку внизу — вместо неё наша кнопка.
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    emit();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const media = window.matchMedia(STANDALONE_QUERY);
  media.addEventListener("change", listener);
  return () => {
    listeners.delete(listener);
    media.removeEventListener("change", listener);
  };
}

export function currentInstallMethod(): InstallMethod {
  const nav = navigator as Navigator & { standalone?: boolean };
  return installMethod({
    standalone: isStandalone({ displayModeStandalone: window.matchMedia(STANDALONE_QUERY).matches, navigatorStandalone: nav.standalone }),
    promptReady: deferred !== null,
    ios: canAddToHomeScreenOnIos(nav.userAgent, nav.maxTouchPoints),
    inApp: isInAppBrowser(nav.userAgent, nav.maxTouchPoints),
  });
}

/** На сервере установить нечего: кнопка появляется только после гидратации. */
const serverSnapshot = (): InstallMethod => "none";

export function useInstallMethod(): InstallMethod {
  return useSyncExternalStore(subscribe, currentInstallMethod, serverSnapshot);
}

/** Показывает системный диалог установки. Событие одноразовое: после ответа кнопка прячется до следующего. */
export async function promptInstall(): Promise<void> {
  const event = deferred;
  if (!event) return;
  deferred = null;
  emit();
  await event.prompt();
  await event.userChoice;
}

/**
 * «Скрыть» у плашки на главной — одно на страницу: плашка и пункт в шапке (он прячется на главной, пока плашка
 * на экране) читают одно значение. До гидратации считаем плашку закрытой — как и method = "none".
 */
let bannerDismissed: boolean | null = null;
export const isBannerDismissed = () => (bannerDismissed ??= readDismissed(() => window.localStorage));

export function useBannerDismissed(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    isBannerDismissed,
    () => true,
  );
}

export function dismissBanner(): void {
  saveDismissed(() => window.localStorage);
  bannerDismissed = true;
  emit();
}
