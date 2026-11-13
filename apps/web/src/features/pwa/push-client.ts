import { isAppleMobile, isStandalone } from "./install-offer";
import { applicationServerKey, pushState, type PushState } from "./push-state";

// Включение и выключение push на этом устройстве (браузерная часть; общая для v1 и v2). Воркер /sw.js регистрирует
// оболочка (PwaSetup); `ready` ждёт, пока он активируется. Разрешение браузер спрашивает только по нажатию.

const hasPushApi = (): boolean => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

const registration = (): Promise<ServiceWorkerRegistration> => navigator.serviceWorker.ready;

/** Состояние этого устройства: что показать вместо кнопки. */
export async function readPushState(): Promise<PushState> {
  const nav = navigator as Navigator & { standalone?: boolean };
  const device = {
    appleMobile: isAppleMobile(nav.userAgent, nav.maxTouchPoints),
    standalone: isStandalone({ displayModeStandalone: window.matchMedia("(display-mode: standalone)").matches, navigatorStandalone: nav.standalone }),
  };
  if (!hasPushApi()) return pushState({ ...device, pushApi: false, permission: "default", subscribed: false });
  const subscription = await (await registration()).pushManager.getSubscription();
  return pushState({ ...device, pushApi: true, permission: Notification.permission, subscribed: subscription !== null });
}

async function send(method: "POST" | "DELETE", body: unknown): Promise<void> {
  const response = await fetch("/api/push", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`push ${response.status}`);
}

/** Подписать устройство и сообщить серверу (тело — `PushSubscription.toJSON()`). */
export async function enablePush(publicKey: string): Promise<void> {
  const current = await registration();
  const subscription =
    (await current.pushManager.getSubscription()) ??
    (await current.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(publicKey) }));
  await send("POST", subscription.toJSON());
}

/** Отписать устройство: сначала сервер (только своя подписка), затем браузер. */
export async function disablePush(): Promise<void> {
  const subscription = await (await registration()).pushManager.getSubscription();
  if (!subscription) return;
  await send("DELETE", { endpoint: subscription.endpoint });
  await subscription.unsubscribe();
}

/** Запрещено ли сайту показывать уведомления (для текста ошибки после неудачной подписки). */
export const pushDenied = (): boolean => typeof Notification !== "undefined" && Notification.permission === "denied";
