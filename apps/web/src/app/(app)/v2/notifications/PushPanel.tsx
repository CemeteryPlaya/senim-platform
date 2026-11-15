"use client";

import { useEffect, useState } from "react";
import { disablePush, enablePush, pushDenied, readPushState } from "@/features/pwa/push-client";
import type { PushState } from "@/features/pwa/push-state";
import { ru } from "@/i18n/ru";
import { Button, Card, Notice } from "@/kit";

const t = ru.app.chat.push;

/**
 * Уведомления на этом устройстве. Состояние читается из браузера после показа страницы (до этого блок без текста
 * состояния): не поддерживается / запрещено в настройках браузера / на iPhone вне установленного приложения — подсказка;
 * выключено — «Включить»; включено — «Выключить». Разрешение браузер спрашивает только по нажатию. Это второстепенное
 * действие: главной кнопки на экране нет.
 */
export function PushPanel({ publicKey }: { publicKey: string }) {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    readPushState()
      .then((s) => alive && setState(s))
      .catch(() => alive && setState("unsupported"));
    return () => {
      alive = false;
    };
  }, []);

  async function run(change: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await change();
    } catch {
      setError(pushDenied() ? t.denied : t.failed);
    } finally {
      setState(await readPushState().catch((): PushState => "unsupported"));
      setBusy(false);
    }
  }

  const text: Record<PushState, string> = {
    "ios-install": t.iosInstall,
    unsupported: t.unsupported,
    denied: t.denied,
    off: t.off,
    on: t.on,
  };

  return (
    <Card as="section">
      <div className="flex flex-col gap-2">
        <h2 className="text-headline text-ink">{t.title}</h2>
        {state !== null && <p className="text-body text-muted" role="status">{text[state]}</p>}
        {(state === "off" || state === "on") && (
          <div className="flex">
            {state === "off" ? (
              <Button variant="secondary" pending={busy} onClick={() => void run(() => enablePush(publicKey))}>
                {busy ? t.enabling : t.enable}
              </Button>
            ) : (
              <Button variant="quiet" pending={busy} onClick={() => void run(disablePush)}>
                {t.disable}
              </Button>
            )}
          </div>
        )}
        {error && <Notice tone="danger" live>{error}</Notice>}
      </div>
    </Card>
  );
}
