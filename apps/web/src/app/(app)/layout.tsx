import type { Metadata, Viewport } from "next";
import { ru } from "@/i18n/ru";
import { fontVariables } from "@/kit/fonts";
import { getTheme } from "@/kit/theme";
import { TOKENS } from "@/kit/tokens";
import "./app.css";

export const metadata: Metadata = {
  title: { default: ru.common.brand, template: `%s — ${ru.common.brand}` },
  description: ru.common.tagline,
  applicationName: ru.common.brand,
  // Установка на iPhone: название под значком и светлая строка состояния (как в v1).
  appleWebApp: { capable: true, title: ru.common.brand, statusBarStyle: "default" },
};

// Цвет строки состояния и заголовка окна — фон страницы своей темы (в Next 16 — через viewport).
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: TOKENS.light.canvas },
    { media: "(prefers-color-scheme: dark)", color: TOKENS.dark.canvas },
  ],
};

/**
 * Корневой layout нового интерфейса (v2, адреса под /v2). Свой документ, отдельный от v1 (группа (legacy)):
 * переход между ними — полная загрузка страницы.
 *
 * Тема: кука `theme` читается на сервере, поэтому страница приходит сразу в нужной теме, без мигания.
 * «Как в системе» — без data-theme: тёмную включает prefers-color-scheme в tokens.css.
 */
export default async function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const theme = await getTheme();

  return (
    <html
      lang="ru"
      className={fontVariables}
      data-theme={theme === "system" ? undefined : theme}
      style={{ colorScheme: theme === "system" ? "light dark" : theme }}
    >
      <body>{children}</body>
    </html>
  );
}
