import type { Metadata } from "next";
import { ru } from "@/i18n/ru";
import "./app.css";

export const metadata: Metadata = {
  title: { default: ru.common.brand, template: `%s — ${ru.common.brand}` },
};

/**
 * Корневой layout нового интерфейса (v2, адреса под /v2). Свой документ, отдельный от v1 (группа (legacy)):
 * переход между ними — полная загрузка страницы. Оболочки, токены и шрифт добавляют следующие задачи этапа 1.
 */
export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
