import type { Metadata } from "next";
import { getCurrentUser } from "@/modules/identity";
import { env } from "@/platform/env";
import { ru } from "@/i18n/ru";
import { DemoBanner } from "@/ui";
import { fontVariables } from "@/ui/fonts";
import { AppFooter } from "./_shell/AppFooter";
import { AppHeader } from "./_shell/AppHeader";
import { MAIN_ID, SkipLink } from "./_shell/SkipLink";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: ru.common.brand, template: `%s — ${ru.common.brand}` },
  description: ru.common.tagline,
};

// Оболочка читает сессию (cookie), поэтому все страницы рендерятся на запрос.
// getCurrentUser() идёт первым: без cookie он не обращается к БД, а env() читается уже во время запроса.
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUser();
  const demoMode = env().DEMO_MODE;

  return (
    <html lang="ru" className={fontVariables}>
      <body className="flex min-h-dvh flex-col">
        <SkipLink />
        {demoMode && <DemoBanner />}
        <AppHeader user={user} demoMode={demoMode} />
        <main id={MAIN_ID} tabIndex={-1} className="flex flex-1 flex-col pb-16 outline-none">
          {children}
        </main>
        <AppFooter />
      </body>
    </html>
  );
}
