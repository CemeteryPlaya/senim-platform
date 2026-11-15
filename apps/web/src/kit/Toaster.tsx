"use client";

import { Loader2 } from "lucide-react";
import { Toaster as Sonner, toast, type ToastClassnames } from "sonner";
import { ru } from "@/i18n/ru";
import type { Device } from "@/platform/device";

/** Показ тоста: `toast("Сохранено")`, `toast.error(...)`. Тексты — из `ru`. */
export { toast };

/** Классы тоста на токенах kit (sonner `unstyled`). Экспорт — для теста. */
export const toastClassNames = {
  // font-sans — на самом тосте: sonner ставит свой шрифт на контейнер стилем без слоя, наследование он перебил бы.
  // Материал — по устройству (TOAST_MATERIAL). Вторичный текст — glass-secondary: читается и на стекле, и на raised.
  toast: "flex w-full items-start gap-3 rounded-card p-4 font-sans text-body text-ink",
  title: "font-medium",
  // mt-0.5 (2 px) здесь и у иконки — оптическое выравнивание по первой строке заголовка (17 px, межстрочный 1,45),
  // а не отступ шкалы.
  description: "mt-0.5 text-sub text-glass-secondary",
  // relative и размер 20 px: sonner кладёт индикатор загрузки в <div class="sonner-loader"> внутри [data-icon]
  // и центрирует его absolute по ближайшему позиционированному предку — без relative это был бы весь тост.
  icon: "relative mt-0.5 size-5 shrink-0",
  actionButton:
    "ml-auto min-h-control shrink-0 rounded-control bg-fill px-4 text-sub font-semibold text-ink pressable",
  cancelButton: "min-h-control shrink-0 rounded-control px-4 text-sub text-glass-secondary",
} as const satisfies ToastClassnames;

/**
 * Материал тоста. Компьютер — толстое стекло (разбор 3.4): тост снизу справа плавает над содержимым, другого стекла там
 * нет. Телефон — сплошной raised с тенью overlay: тост сверху по центру лёг бы на стекло закреплённой шапки переписки и
 * круглых кнопок (колокольчик, «…») — стекло на стекле запрещено. Экспорт — для теста.
 */
export const TOAST_MATERIAL: Record<Device, string> = {
  mobile: "bg-raised shadow-overlay",
  desktop: "glass-thick",
};

/**
 * Место для тостов, одно на оболочку. Телефон — сверху по центру (низ занят панелью вкладок и главной кнопкой),
 * компьютер — снизу справа. Вид — токены kit (`unstyled` снимает оформление sonner, раскладку и жест смахивания
 * оставляет). Материал — `TOAST_MATERIAL`: на компьютере толстое стекло, на телефоне сплошной raised. Появляется со
 * стороны своего края (сверху на телефоне, снизу на компьютере) и уходит туда же. `prefers-reduced-motion` — в
 * overlays.css: проявление вместо выезда; там же кольцо фокуса тоста (CSS sonner без слоя иначе перебивает наше).
 */
export function Toaster({ device }: { device: Device }) {
  return (
    <Sonner
      position={device === "mobile" ? "top-center" : "bottom-right"}
      customAriaLabel={ru.app.kit.notifications}
      icons={{
        // Свой индикатор: цвет из токенов; при меньшем движении он пульсирует (app.css), а не замирает,
        // как индикатор sonner (тот под prefers-reduced-motion получает animation: none).
        loading: <Loader2 aria-hidden className="size-5 animate-spin text-glass-secondary" />,
      }}
      toastOptions={{
        unstyled: true,
        closeButtonAriaLabel: ru.app.kit.close,
        classNames: { ...toastClassNames, toast: `${toastClassNames.toast} ${TOAST_MATERIAL[device]}` },
      }}
    />
  );
}
