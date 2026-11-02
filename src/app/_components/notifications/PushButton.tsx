"use client";

import { Bell, BellOff, Share } from "lucide-react";
import { useEffect, useState } from "react";
import { ru } from "@/i18n/ru";
import { Alert, Button } from "@/ui";
import { isAppleMobile, isStandalone } from "../install/install-offer";
import { applicationServerKey, pushState, type PushState } from "./push-state";

const t = ru.notifications.push;

export type PushButtonProps = {
  /** Публичный VAPID-ключ (EnablePush передаёт его с сервера). */
  publicKey: string;
};

async function currentRegistration(): Promise<ServiceWorkerRegistration> {
  // Воркер /sw.js регистрирует PwaSetup в корневом layout; ready ждёт, пока он активируется.
  return navigator.serviceWorker.ready;
}

const hasPushApi = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

async function readState(): Promise<PushState> {
  const nav = navigator as Navigator & { standalone?: boolean };
  const device = {
    appleMobile: isAppleMobile(nav.userAgent, nav.maxTouchPoints),
    standalone: isStandalone({ displayModeStandalone: window.matchMedia("(display-mode: standalone)").matches, navigatorStandalone: nav.standalone }),
  };
  if (!hasPushApi()) return pushState({ ...device, pushApi: false, permission: "default", subscribed: false });
  const subscription = await (await currentRegistration()).pushManager.getSubscription();
  return pushState({ ...device, pushApi: true, permission: Notification.permission, subscribed: subscription !== null });
}

async function send(method: "POST" | "DELETE", body: unknown): Promise<void> {
  const response = await fetch("/api/push", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`push ${response.status}`);
}

async function enable(publicKey: string): Promise<void> {
  const registration = await currentRegistration();
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(publicKey) }));
  await send("POST", subscription.toJSON());
}

async function disable(): Promise<void> {
  const subscription = await (await currentRegistration()).pushManager.getSubscription();
  if (!subscription) return;
  await send("DELETE", { endpoint: subscription.endpoint });
  await subscription.unsubscribe();
}

/**
 * «Включить уведомления» на этом устройстве. На iPhone вне установленного приложения — подсказка,
 * как его установить (push на iOS приходит только туда, iOS 16.4+). До гидратации ничего не рисует.
 */
export function PushButton({ publicKey }: PushButtonProps) {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    readState()
      .then((s) => alive && setState(s))
      .catch(() => alive && setState("unsupported"));
    return () => {
      alive = false;
    };
  }, []);

  async function run(change: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      // Разрешение спрашивается только по нажатию — браузеры блокируют запрос без действия пользователя.
      await change();
    } catch {
      setError(Notification.permission === "denied" ? t.denied : t.failed);
    } finally {
      setState(await readState().catch((): PushState => "unsupported"));
      setBusy(false);
    }
  }

  if (state === null || state === "unsupported") return null;
  if (state === "ios-install") return <IosInstallHint />;
  if (state === "denied") return <Alert tone="warning">{t.denied}</Alert>;
  return (
    <div className="flex flex-col gap-2">
      {state === "on" ? <EnabledControls busy={busy} onDisable={() => void run(disable)} /> : <EnableControls busy={busy} onEnable={() => void run(() => enable(publicKey))} />}
      {error && (
        <Alert tone="danger" live="assertive">
          {error}
        </Alert>
      )}
    </div>
  );
}

function IosInstallHint() {
  return (
    <Alert title={t.iosInstall.title}>
      <span className="flex items-start gap-3">
        <Share aria-hidden className="mt-0.5 size-6 shrink-0 text-primary" />
        <span>{t.iosInstall.body}</span>
      </span>
    </Alert>
  );
}

function EnabledControls({ busy, onDisable }: { busy: boolean; onDisable: () => void }) {
  return (
    <>
      <p className="text-base text-ink" role="status">
        {t.enabled}
      </p>
      <Button variant="ghost" icon={<BellOff />} loading={busy} onClick={onDisable}>
        {t.disable}
      </Button>
    </>
  );
}

function EnableControls({ busy, onEnable }: { busy: boolean; onEnable: () => void }) {
  return (
    <>
      <Button variant="soft" icon={<Bell />} loading={busy} onClick={onEnable}>
        {busy ? t.enabling : t.enable}
      </Button>
      <p className="text-base text-ink-soft">{t.hint}</p>
    </>
  );
}
