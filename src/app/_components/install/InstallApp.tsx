"use client";

import { Download, Share, X } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { ru } from "@/i18n/ru";
import { Button } from "@/ui";
import { showBanner, showHeaderItem, type InstallMethod } from "./install-offer";
import { usePathname } from "next/navigation";
import { dismissBanner, promptInstall, useBannerDismissed, useInstallMethod } from "./install-store";

const t = ru.pwa.install;

type HintMethod = Exclude<InstallMethod, "prompt" | "none">;

/** Подсказка вместо системного диалога: iPhone — путь через «Поделиться», встроенный браузер — открыть в Safari/Chrome. */
function Hint({ id, method }: { id?: string; method: HintMethod }) {
  return (
    <p id={id} className="flex items-start gap-3 text-base text-ink">
      <Share aria-hidden className="mt-0.5 size-6 shrink-0 text-primary" />
      <span>{method === "ios-hint" ? t.iosHint : t.openInBrowserHint}</span>
    </p>
  );
}

type ActionProps = {
  method: Exclude<InstallMethod, "none">;
  label: ReactNode;
  /** Полное название для скринридера, если видимая подпись короче. */
  ariaLabel?: string;
  className?: string;
  panelClassName?: string;
};

/** Кнопка установки: на Android — системный диалог, иначе раскрывает подсказку под собой. */
function InstallAction({ method, label, ariaLabel, className, panelClassName }: ActionProps) {
  const [hintOpen, setHintOpen] = useState(false);
  const hintId = useId();
  if (method === "prompt") {
    return (
      <Button variant="ghost" icon={<Download />} aria-label={ariaLabel} className={className} onClick={() => void promptInstall()}>
        {label}
      </Button>
    );
  }
  return (
    <>
      <Button variant="ghost" icon={<Download />} aria-label={ariaLabel} className={className} aria-expanded={hintOpen} aria-controls={hintId} onClick={() => setHintOpen((open) => !open)}>
        {label}
      </Button>
      {hintOpen && (
        <div className={panelClassName}>
          <Hint id={hintId} method={method} />
        </div>
      )}
    </>
  );
}

/**
 * Пункт «Установить приложение» в шапке сайта — у гостя и у вошедшего. Есть, пока установить можно: на Android — системный
 * диалог, на iPhone и во встроенном браузере — подсказка под кнопкой. Установлено или событие не пришло — пункта нет.
 */
export function InstallHeaderItem({ guest }: { guest: boolean }) {
  const method = useInstallMethod();
  const bannerDismissed = useBannerDismissed();
  const pathname = usePathname();
  // На стартовом экране гостя то же действие предлагает плашка внизу — в шапке на узком экране для него нет места.
  if (guest && pathname === "/" && showBanner(method, bannerDismissed)) return null;
  if (!showHeaderItem(method)) return null;
  return (
    <div className="relative">
      <InstallAction
        method={method}
        label={<span className="max-[25.5em]:sr-only">{t.actionShort}</span>}
        ariaLabel={t.action}
        className="min-w-12 shrink-0 whitespace-nowrap px-2! sm:px-3!"
        panelClassName="absolute right-0 top-full z-40 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-card border-2 border-line bg-surface p-4 shadow-bar"
      />
    </div>
  );
}

/** Пункт «Установить приложение» на странице «Профиль». */
export function InstallMenuItem() {
  const method = useInstallMethod();
  if (!showHeaderItem(method)) return null;
  return (
    <div className="flex flex-col gap-2">
      <InstallAction method={method} label={t.action} className="w-full" panelClassName="px-4 pb-2" />
    </div>
  );
}

/**
 * Плашка внизу стартового экрана гостя: мелкая, не модальная, закрывается крестиком. Не конкурирует с главной кнопкой:
 * в ней только «мягкая» кнопка. Закрытая плашка не возвращается; пункт в шапке остаётся.
 */
export function InstallBanner() {
  const method = useInstallMethod();
    const dismissed = useBannerDismissed();
  const titleId = useId();
  if (method === "none" || !showBanner(method, dismissed)) return null;

  return (
    <section aria-labelledby={titleId} className="mx-auto mt-2 flex max-w-page items-start gap-3 px-4 sm:px-6">
      <div className="flex min-w-0 flex-1 flex-col gap-3 rounded-card border-2 border-line bg-surface p-4">
        <h2 id={titleId} className="text-base font-bold text-ink">
          {t.title}
        </h2>
        {method === "prompt" ? (
          <div>
            <Button variant="soft" icon={<Download />} onClick={() => void promptInstall()}>
              {t.action}
            </Button>
          </div>
        ) : (
          <Hint method={method} />
        )}
      </div>
      <button type="button" aria-label={t.hideLabel} onClick={dismissBanner} className="inline-flex size-12 shrink-0 items-center justify-center rounded-button text-ink hover:bg-sunken">
        <X aria-hidden className="size-6" />
      </button>
    </section>
  );
}
