import type { Metadata, Viewport } from "next";
import { ru } from "@/i18n/ru";
import { getShellUser, needsSecondFactor } from "@/modules/identity";
import { unreadCount } from "@/modules/notifications";
import { cn, Toaster } from "@/kit";
import { fontVariables } from "@/kit/fonts";
import { getTheme } from "@/kit/theme";
import { TOKENS } from "@/kit/tokens";
import { getDevice } from "@/platform/device";
import { features } from "@/platform/features";
import { logger } from "@/platform/logger";
import { DesktopShell } from "./_shell/DesktopShell";
import { MobileShell } from "./_shell/MobileShell";
import { navFor } from "./_shell/nav";
import { pendingOnboarding } from "./_shell/onboarding";
import { OperatorMoving } from "./_shell/OperatorMoving";
import { PwaSetup } from "./_shell/PwaSetup";
import "./app.css";

export const metadata: Metadata = {
  title: { default: ru.common.brand, template: `%s — ${ru.common.brand}` },
  description: ru.common.tagline,
  applicationName: ru.common.brand,
  // Установка на iPhone: название под значком и светлая строка состояния (как в v1).
  appleWebApp: { capable: true, title: ru.common.brand, statusBarStyle: "default" },
  // Временные страницы v2 (заглушки, витрина) не индексируются, пока основной интерфейс — v1.
  // Убрать при переключении на этапе 6.
  robots: { index: false, follow: false },
};

/**
 * Цвет строки состояния и заголовка окна — фон страницы своей темы (в Next 16 — через viewport). Тема выбрана кукой —
 * одно значение; «Авто» — пара для светлой и тёмной по prefers-color-scheme.
 * Телефон: viewport-fit=cover — страница рисуется до краёв экрана, а env(safe-area-inset-*) получают настоящие значения;
 * отступы от выреза и полоски «домой» держат утилиты dock-* и safe-* (tokens.css). Компьютеру это не нужно.
 */
export async function generateViewport(): Promise<Viewport> {
  const [theme, device] = await Promise.all([getTheme(), getDevice()]);
  const themeColor: Viewport["themeColor"] =
    theme !== "system"
      ? TOKENS[theme].canvas
      : [
          { media: "(prefers-color-scheme: light)", color: TOKENS.light.canvas },
          { media: "(prefers-color-scheme: dark)", color: TOKENS.dark.canvas },
        ];
  return device === "mobile" ? { themeColor, viewportFit: "cover" } : { themeColor };
}

/** Непрочитанных уведомлений; при сбое базы — 0 (колокольчик без числа), в журнал — предупреждение. */
async function unreadOf(userId: string): Promise<number> {
  try {
    return await unreadCount(userId);
  } catch (e) {
    logger.warn("shell.unread.failed", { error: e });
    return 0;
  }
}

/**
 * Корневой layout нового интерфейса (v2, адреса под /v2). Свой документ, отдельный от v1 (группа (legacy)):
 * переход между ними — полная загрузка страницы.
 *
 * Тема: кука `theme` читается на сервере, поэтому страница приходит сразу в нужной теме, без мигания.
 * «Авто» — без data-theme: тёмную включает prefers-color-scheme в tokens.css.
 * Версия (телефон или компьютер) — getDevice() по заголовкам запроса, не по ширине окна: data-device на <html>
 * включает размеры компьютера в tokens.css, оболочка — MobileShell или DesktopShell.
 */
export default async function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // getShellUser() идёт первым: без cookie он не обращается к БД, а env() (features) читается уже во время запроса.
  const { user, unavailable } = await getShellUser();
  const [theme, device] = await Promise.all([getTheme(), getDevice()]);
  // Пока не пройдены первые шаги (согласие, знакомство, почта; у оператора — второй шаг входа) — сосредоточенная оболочка:
  // только название и «Выйти». Меню оператора без второго шага вело бы на разделы, которые всё равно вернут на код.
  const focus = user !== null && (pendingOnboarding(user).length > 0 || needsSecondFactor(user));
  const nav = navFor(user, features(), { focus });
  // Счётчик уведомлений — один запрос на запрос страницы, только вошедшему с пройденными первыми шагами (в
  // сосредоточенной оболочке колокольчика нет, у гостя — тоже). Сбой чтения счётчика не должен ронять всю оболочку.
  const unread = user && !nav.focus ? await unreadOf(user.id) : null;
  // Разделы оператора переносятся по частям (этап 5): на ещё не перенесённых адресах оператору вместо страницы v2 —
  // заглушка со ссылкой на тот же адрес в v1 (список готовых — _shell/operator-sections.ts). Это только интерфейс, а не
  // граница доступа: страница всё равно выполняется на сервере, и права проверяют она сама и действия сервера.
  const content = user?.role === "OPERATOR" ? <OperatorMoving>{children}</OperatorMoving> : children;

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
          <MobileShell nav={nav} unread={unread} unavailable={unavailable}>
            {content}
          </MobileShell>
        ) : (
          <DesktopShell nav={nav} user={user} theme={theme} unread={unread ?? 0} unavailable={unavailable}>
            {content}
          </DesktopShell>
        )}
        <Toaster device={device} />
        <PwaSetup />
      </body>
    </html>
  );
}
