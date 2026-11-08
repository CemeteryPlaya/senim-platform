"use client";

import { Download, ExternalLink, Share, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ru } from "@/i18n/ru";
import { Button } from "@/ui";
import { showBanner, showHeaderItem, type InstallMethod } from "./install-offer";
import { dismissBanner, promptInstall, useBannerDismissed, useInstallMethod } from "./install-store";

const t = ru.pwa.install;

type HintMethod = Exclude<InstallMethod, "prompt" | "none">;

/** Подсказка вместо системного диалога: iPhone — путь через «Поделиться», встроенный браузер — открыть в Safari/Chrome. */
function Hint({ id, method }: { id?: string; method: HintMethod }) {
  const Icon = method === "ios-hint" ? Share : ExternalLink;
  return (
    <p id={id} className="flex items-start gap-3 text-base text-ink">
      <Icon aria-hidden className="mt-0.5 size-6 shrink-0 text-primary" />
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

/**
 * Кнопка установки: на Android — системный диалог, иначе раскрывает подсказку. Подсказка закрывается
 * повторным нажатием, Escape и нажатием вне её; после Escape фокус возвращается на кнопку.
 */
function InstallAction({ method, label, ariaLabel, className, panelClassName }: ActionProps) {
  const [hintOpen, setHintOpen] = useState(false);
  const hintId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hintOpen) return;
    const close = (returnFocus: boolean) => {
      setHintOpen(false);
      if (returnFocus) rootRef.current?.querySelector("button")?.focus();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(true);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) close(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [hintOpen]);

  if (method === "prompt") {
    return (
      <Button variant="ghost" icon={<Download />} aria-label={ariaLabel} className={className} onClick={() => void promptInstall()}>
        {label}
      </Button>
    );
  }
  return (
    <div ref={rootRef} className="contents">
      <Button variant="ghost" icon={<Download />} aria-label={ariaLabel} className={className} aria-expanded={hintOpen} aria-controls={hintId} onClick={() => setHintOpen((open) => !open)}>
        {label}
      </Button>
      {hintOpen && (
        <div className={panelClassName}>
          <Hint id={hintId} method={method} />
        </div>
      )}
    </div>
  );
}

/**
 * Пункт «Установить приложение» в шапке сайта — у гостя и у вошедшего. Есть, пока установить можно: на Android — системный
 * диалог, на iPhone и во встроенном браузере — подсказка под шапкой (на телефоне на всю ширину, шире — под кнопкой). Установлено или событие не пришло — пункта нет.
 */
export function InstallHeaderItem({ guest }: { guest: boolean }) {
  const method = useInstallMethod();
  const bannerDismissed = useBannerDismissed();
  const pathname = usePathname();
  // На стартовом экране гостя то же действие предлагает плашка внизу — в шапке на узком экране для него нет места.
  if (guest && pathname === "/" && showBanner(method, bannerDismissed)) return null;
  if (!showHeaderItem(method)) return null;
  return (
    <div className="sm:relative">
      <InstallAction
        method={method}
        label={<span className="max-[25.5em]:sr-only">{t.actionShort}</span>}
        ariaLabel={t.action}
        className="min-w-12 shrink-0 whitespace-nowrap px-2! sm:px-3!"
        panelClassName="absolute inset-x-4 top-full z-40 mt-2 rounded-card border-2 border-line bg-surface p-4 shadow-bar sm:inset-x-auto sm:right-0 sm:w-72"
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
