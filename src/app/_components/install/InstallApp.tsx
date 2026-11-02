"use client";

import { Download, Share } from "lucide-react";
import { useId, useState } from "react";
import { ru } from "@/i18n/ru";
import { Button, Card } from "@/ui";
import { readDismissed, saveDismissed, showBanner } from "./install-offer";
import { promptInstall, useInstallMethod } from "./install-store";

const t = ru.pwa.install;
const storage = () => window.localStorage;

function IosHint({ id }: { id?: string }) {
  return (
    <p id={id} className="flex items-start gap-3 text-base text-ink">
      <Share aria-hidden className="mt-0.5 size-6 shrink-0 text-primary" />
      <span>{t.iosHint}</span>
    </p>
  );
}

/**
 * Пункт «Установить приложение» в меню «Ещё» на телефоне. Есть, пока установить можно:
 * в Chrome и Edge — системный диалог, на iPhone — раскрывает подсказку про «Поделиться».
 */
export function InstallMenuItem() {
  const method = useInstallMethod();
  const [hintOpen, setHintOpen] = useState(false);
  const hintId = useId();
  if (method === "none") return null;
  if (method === "prompt") {
    return (
      <Button variant="ghost" fullWidth icon={<Download />} onClick={() => void promptInstall()}>
        {t.action}
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <Button variant="ghost" fullWidth icon={<Download />} aria-expanded={hintOpen} aria-controls={hintId} onClick={() => setHintOpen((open) => !open)}>
        {t.action}
      </Button>
      {hintOpen && (
        <div className="px-4 pb-2">
          <IosHint id={hintId} />
        </div>
      )}
    </div>
  );
}

/** Плашка на главной — только на телефоне и планшете (до lg, как нижняя панель), закрывается «Скрыть». */
export function InstallBanner() {
  const method = useInstallMethod();
  // До гидратации method = "none" и плашки нет, поэтому чтение localStorage здесь не расходится с сервером.
  const [dismissed, setDismissed] = useState(() => typeof window !== "undefined" && readDismissed(storage));
  const titleId = useId();
  if (!showBanner(method, dismissed)) return null;

  const hide = () => {
    saveDismissed(storage);
    setDismissed(true);
  };

  return (
    <Card
      as="section"
      title={t.title}
      titleAs="h2"
      titleId={titleId}
      description={t.text}
      className="lg:hidden"
      footer={
        <>
          {method === "prompt" && (
            <Button variant="soft" icon={<Download />} onClick={() => void promptInstall()}>
              {t.action}
            </Button>
          )}
          <Button variant="ghost" onClick={hide}>
            {t.hide}
          </Button>
        </>
      }
    >
      {method === "ios-hint" && <IosHint />}
    </Card>
  );
}
