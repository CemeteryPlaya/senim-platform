import type { Metadata, Viewport } from "next";
import { ru } from "@/i18n/ru";
import { getShellUser } from "@/modules/identity";
import { cn } from "@/kit/cn";
import { fontVariables } from "@/kit/fonts";
import { getTheme } from "@/kit/theme";
import { Toaster } from "@/kit/Toaster";
import { TOKENS } from "@/kit/tokens";
import { getDevice } from "@/platform/device";
import { features } from "@/platform/features";
import { DesktopShell } from "./_shell/DesktopShell";
import { MobileShell } from "./_shell/MobileShell";
import { navFor } from "./_shell/nav";
import { OperatorMoving } from "./_shell/OperatorMoving";
import "./app.css";

export const metadata: Metadata = {
  title: { default: ru.common.brand, template: `%s — ${ru.common.brand}` },
  description: ru.common.tagline,
  applicationName: ru.common.brand,
  // Установка на iPhone: название под значком и светлая строка состояния (как в v1).
  appleWebApp: { capable: true, title: ru.common.brand, statusBarStyle: "default" },
};

/**
 * Цвет строки состояния и заголовка окна — фон страницы своей темы (в Next 16 — через viewport). Тема выбрана кукой —
 * одно значение; «как в системе» — пара для светлой и тёмной по prefers-color-scheme.
 */
export async function generateViewport(): Promise<Viewport> {
  const theme = await getTheme();
  if (theme !== "system") return { themeColor: TOKENS[theme].canvas };
  return {
    themeColor: [
      { media: "(prefers-color-scheme: light)", color: TOKENS.light.canvas },
      { media: "(prefers-color-scheme: dark)", color: TOKENS.dark.canvas },
    ],
  };
}

/**
 * Корневой layout нового интерфейса (v2, адреса под /v2). Свой документ, отдельный от v1 (группа (legacy)):
 * переход между ними — полная загрузка страницы.
 *
 * Тема: кука `theme` читается на сервере, поэтому страница приходит сразу в нужной теме, без мигания.
 * «Как в системе» — без data-theme: тёмную включает prefers-color-scheme в tokens.css.
 * Версия (телефон или компьютер) — getDevice() по заголовкам запроса, не по ширине окна: data-device на <html>
 * включает размеры компьютера в tokens.css, оболочка — MobileShell или DesktopShell.
 */
export default async function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // getShellUser() идёт первым: без cookie он не обращается к БД, а env() (features) читается уже во время запроса.
  const { user, unavailable } = await getShellUser();
  const [theme, device] = await Promise.all([getTheme(), getDevice()]);
  const nav = navFor(user, features());
  // Оболочка оператора — этап 5; до неё любая страница v2 у оператора — заглушка со ссылкой на тот же адрес в v1.
  const content = user?.role === "OPERATOR" ? <OperatorMoving /> : children;

  return (
    <html
      lang="ru"
      // Прилипшая шапка компьютера не закрывает элемент, к которому прокрутили (якорь, фокус с клавиатуры).
      className={cn(fontVariables, device === "desktop" && "scroll-pt-header")}
      data-theme={theme === "system" ? undefined : theme}
      data-device={device}
      // color-scheme есть и в tokens.css, но inline-стиль действует с первого байта HTML, ещё до загрузки app.css:
      // фон окна, полосы прокрутки и поля браузера сразу в нужной теме, без белой вспышки.
      style={{ colorScheme: theme === "system" ? "light dark" : theme }}
    >
      <body>
        {device === "mobile" ? (
          <MobileShell nav={nav} unavailable={unavailable}>
            {content}
          </MobileShell>
        ) : (
          <DesktopShell nav={nav} user={user} unavailable={unavailable}>
            {content}
          </DesktopShell>
        )}
        <Toaster device={device} />
      </body>
    </html>
  );
}
