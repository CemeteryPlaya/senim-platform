import type { Metadata } from "next";
import { ru } from "@/i18n/ru";
import "./globals.css";

export const metadata: Metadata = {
  title: ru.common.brand,
  description: ru.common.tagline,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
