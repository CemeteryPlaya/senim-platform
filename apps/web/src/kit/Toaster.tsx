"use client";

import { Toaster as Sonner, toast } from "sonner";
import { ru } from "@/i18n/ru";
import type { Device } from "@/platform/device";

/** Показ тоста: `toast("Сохранено")`, `toast.error(...)`. Тексты — из `ru`. */
export { toast };

/**
 * Место для тостов, одно на оболочку. Телефон — сверху по центру (низ занят панелью вкладок и главной кнопкой),
 * компьютер — снизу справа. Вид — токены kit (`unstyled` снимает оформление sonner, раскладку и жест смахивания
 * оставляет). Фон сплошной `raised`, тень `float`. `prefers-reduced-motion` — в overlays.css: проявление вместо выезда.
 */
export function Toaster({ device }: { device: Device }) {
  return (
    <Sonner
      position={device === "mobile" ? "top-center" : "bottom-right"}
      customAriaLabel={ru.app.kit.notifications}
      toastOptions={{
        unstyled: true,
        closeButtonAriaLabel: ru.app.kit.close,
        classNames: {
          // font-sans — на самом тосте: sonner ставит свой шрифт на контейнер стилем без слоя, наследование он перебил бы.
          toast: "flex items-start gap-3 rounded-card bg-raised p-4 font-sans text-body text-ink shadow-float",
          title: "font-medium",
          description: "mt-0.5 text-sub text-muted",
          icon: "mt-0.5 shrink-0",
          actionButton:
            "ml-auto min-h-control-sm shrink-0 rounded-control bg-line px-4 text-sub font-semibold text-ink transition-transform duration-100 active:scale-press",
          cancelButton: "min-h-control-sm shrink-0 rounded-control px-4 text-sub text-muted",
        },
      }}
    />
  );
}
