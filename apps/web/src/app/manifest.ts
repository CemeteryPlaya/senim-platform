import type { MetadataRoute } from "next";
import { ru } from "@/i18n/ru";
import { TOKENS } from "@/kit/tokens";

/**
 * Манифест для установки на телефон (/manifest.webmanifest; ссылку в <head> Next добавляет сам).
 * Значки — public/icons, их рисует scripts/generate-icons.mjs. Без пароля стенда (stand-gate).
 * Старт — новый интерфейс (/v2), цвета — токены v2 (светлая тема: манифест не умеет пару для тёмной; в самой странице
 * `theme-color` задан парой для обеих тем). `id` прежний («/»): установленные приложения остаются тем же приложением.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: ru.common.brand,
    short_name: ru.common.brand,
    description: ru.common.tagline,
    lang: "ru",
    dir: "ltr",
    start_url: "/v2",
    scope: "/",
    display: "standalone",
    background_color: TOKENS.light.canvas,
    theme_color: TOKENS.light.canvas,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
