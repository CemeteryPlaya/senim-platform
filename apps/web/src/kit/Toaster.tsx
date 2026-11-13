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
  toast: "flex w-full items-start gap-3 rounded-card bg-raised p-4 font-sans text-body text-ink shadow-float",
  title: "font-medium",
  // mt-0.5 (2 px) здесь и у иконки — оптическое выравнивание по первой строке заголовка (17 px, межстрочный 1,45),
  // а не отступ шкалы.
  description: "mt-0.5 text-sub text-muted",
  // relative и размер 20 px: sonner кладёт индикатор загрузки в <div class="sonner-loader"> внутри [data-icon]
  // и центрирует его absolute по ближайшему позиционированному предку — без relative это был бы весь тост.
  icon: "relative mt-0.5 size-5 shrink-0",
  actionButton:
    "ml-auto min-h-control shrink-0 rounded-control bg-line px-4 text-sub font-semibold text-ink pressable",
  cancelButton: "min-h-control shrink-0 rounded-control px-4 text-sub text-muted",
} as const satisfies ToastClassnames;

/**
 * Место для тостов, одно на оболочку. Телефон — сверху по центру (низ занят панелью вкладок и главной кнопкой),
 * компьютер — снизу справа. Вид — токены kit (`unstyled` снимает оформление sonner, раскладку и жест смахивания
 * оставляет). Фон сплошной `raised`, тень `float`. `prefers-reduced-motion` — в overlays.css: проявление вместо
 * выезда; там же кольцо фокуса тоста (CSS sonner без слоя иначе перебивает наше).
 */
export function Toaster({ device }: { device: Device }) {
  return (
    <Sonner
      position={device === "mobile" ? "top-center" : "bottom-right"}
      customAriaLabel={ru.app.kit.notifications}
      icons={{
        // Свой индикатор: цвет из токенов; при меньшем движении он пульсирует (app.css), а не замирает,
        // как индикатор sonner (тот под prefers-reduced-motion получает animation: none).
        loading: <Loader2 aria-hidden className="size-5 animate-spin text-muted" />,
      }}
      toastOptions={{
        unstyled: true,
        closeButtonAriaLabel: ru.app.kit.close,
        classNames: toastClassNames,
      }}
    />
  );
}
