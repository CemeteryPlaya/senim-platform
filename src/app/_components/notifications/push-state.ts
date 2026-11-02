/**
 * Что показать вместо кнопки push. Чистые функции: состояние браузера передаётся параметрами.
 *
 * ios-install — iPhone/iPad вне установленного приложения: push там приходит только в приложении,
 *   добавленном на экран «Домой» (iOS 16.4+), — показываем подсказку, а не кнопку;
 * unsupported — у браузера нет Push API; denied — пользователь запретил уведомления сайту;
 * off/on — можно включить или уже включено на этом устройстве.
 */
export type PushState = "ios-install" | "unsupported" | "denied" | "off" | "on";

export function pushState(env: {
  appleMobile: boolean;
  standalone: boolean;
  pushApi: boolean;
  permission: "default" | "granted" | "denied";
  subscribed: boolean;
}): PushState {
  if (env.appleMobile && !env.standalone) return "ios-install";
  if (!env.pushApi) return "unsupported";
  if (env.permission === "denied") return "denied";
  return env.subscribed && env.permission === "granted" ? "on" : "off";
}

/** Публичный VAPID-ключ (base64url) → байты для pushManager.subscribe({ applicationServerKey }). */
export function applicationServerKey(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
