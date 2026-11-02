import type { MetadataRoute } from "next";
import { ru } from "@/i18n/ru";
import { BRAND_COLORS } from "@/ui/brand";

/**
 * Манифест для установки на телефон (/manifest.webmanifest; ссылку в <head> Next добавляет сам).
 * Значки — public/icons, их рисует scripts/generate-icons.mjs. Без пароля демо-стенда (demo-gate).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: ru.common.brand,
    short_name: ru.common.brand,
    description: ru.common.tagline,
    lang: "ru",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: BRAND_COLORS.canvas,
    theme_color: BRAND_COLORS.primary,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
