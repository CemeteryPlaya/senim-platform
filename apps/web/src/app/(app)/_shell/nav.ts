import type { Role } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { to } from "./paths";

// Навигация оболочек v2 (спека редизайна, раздел 5): у каждой роли не больше пяти вкладок — панель вкладок на телефоне
// и разделы в шапке на компьютере. Остальные разделы — на экранах (профиль, уведомления — колокольчик в шапке).

/** Иконка вкладки — ключ; компонент lucide выбирает оболочка (nav-icons.ts). */
export type NavIcon =
  | "home"
  | "masters"
  | "about"
  | "login"
  | "requests"
  | "deals"
  | "orders"
  | "chat"
  | "finance"
  | "profile"
  | "company"
  | "portfolio"
  | "measurements";

export type NavItem = { href: string; label: string; icon: NavIcon };

/**
 * tabs — панель вкладок телефона; sections — разделы в шапке компьютера (у вошедших те же, что вкладки); action —
 * действие справа в шапке компьютера (кнопка `secondary`: главная кнопка принадлежит экрану); guest — не вошёл;
 * focus — сосредоточенная оболочка (у вошедшего не пройдены первые шаги): ни вкладок, ни разделов, ни действия — только
 * название продукта и «Выйти» (рисует оболочка).
 */
export type AppNav = {
  tabs: NavItem[];
  sections: NavItem[];
  action?: { href: string; label: string };
  guest: boolean;
  focus: boolean;
};

/** Ровно то, что нужно навигации от текущего пользователя (подмножество CurrentUser из identity). */
export type NavUser = {
  role: Role;
  executor: { status: "PENDING" | "APPROVED" | "REJECTED" } | null;
};

/** Флаги (platform/features), от которых зависят вкладки: раздел за выключенным флагом в меню не показывается. */
export type NavFeatures = { preContractFlows: boolean; inspiration: boolean; materialsCalculator: boolean };

const t = ru.app.shell.nav;

const R = {
  home: { href: to("/"), label: t.home, icon: "home" },
  masters: { href: to("/catalog"), label: t.masters, icon: "masters" },
  about: { href: to("/about"), label: t.about, icon: "about" },
  login: { href: to("/login"), label: t.login, icon: "login" },
  requests: { href: to("/requests"), label: t.requests, icon: "requests" },
  deals: { href: to("/deals"), label: t.deals, icon: "deals" },
  incoming: { href: to("/executor/requests"), label: t.requests, icon: "requests" },
  orders: { href: to("/deals"), label: t.orders, icon: "orders" },
  chat: { href: to("/chats"), label: t.chat, icon: "chat" },
  finance: { href: to("/executor/finance"), label: t.finance, icon: "finance" },
  profile: { href: to("/profile"), label: t.profile, icon: "profile" },
  company: { href: to("/executor/profile"), label: t.company, icon: "company" },
  portfolio: { href: to("/executor/portfolio"), label: t.portfolio, icon: "portfolio" },
  measurements: { href: to("/measurer"), label: t.measurements, icon: "measurements" },
} as const satisfies Record<string, NavItem>;

/** Вкладки за флагами: «Замеры» замерщика — сценарии до договора (Фаза 2, по умолчанию выключены). */
const FLAGGED: Readonly<Partial<Record<NavItem["href"], keyof NavFeatures>>> = {
  [R.measurements.href]: "preContractFlows",
};

function roleTabs(user: NavUser): NavItem[] {
  switch (user.role) {
    case "CLIENT":
      return [R.home, R.requests, R.deals, R.chat, R.profile];
    case "EXECUTOR":
      return user.executor?.status === "APPROVED"
        ? [R.incoming, R.orders, R.chat, R.finance, R.profile]
        : [R.company, R.portfolio, R.profile];
    case "MEASURER":
      return [R.measurements, R.chat, R.profile];
    case "OPERATOR":
      // Оболочка оператора (меню слева по группам) — этап 5; до неё оператор в v2 видит заглушку со ссылкой на v1.
      return [];
  }
}

/**
 * Меню пользователя (null — гость). Вкладки за выключенными флагами не попадают.
 * Гость: на телефоне — Главная · Мастера · О сервисе · Войти («Войти» — последняя вкладка); в шапке компьютера —
 * разделы Мастера · О сервисе (на главную ведёт название продукта), «Войти» — действие справа.
 * `options.focus` — у вошедшего есть непройденные первые шаги: сосредоточенная оболочка (см. AppNav.focus).
 */
export function navFor(user: NavUser | null, f: NavFeatures, options: { focus?: boolean } = {}): AppNav {
  // Первые шаги после входа (согласие, знакомство, почта): человеку нужно пройти их, а не переходить по разделам.
  if (user && options.focus) return { tabs: [], sections: [], guest: false, focus: true };
  if (!user) {
    return {
      tabs: [R.home, R.masters, R.about, R.login],
      sections: [R.masters, R.about],
      action: { href: R.login.href, label: R.login.label },
      guest: true,
      focus: false,
    };
  }
  const tabs = roleTabs(user).filter((item) => {
    const flag = FLAGGED[item.href];
    return flag === undefined || f[flag];
  });
  const action = user.role === "CLIENT" ? { href: to("/requests/new"), label: ru.app.shell.newRequest } : undefined;
  return action ? { tabs, sections: tabs, action, guest: false, focus: false } : { tabs, sections: tabs, guest: false, focus: false };
}

/**
 * Адрес активной вкладки для aria-current="page": раздел, под которым лежит адрес (по целым сегментам), самый точный
 * из подходящих. Главная v2 подсвечивается только на самой главной. `null` — адреса нет (рендер вне роутера).
 */
export function activeHref(items: readonly NavItem[], pathname: string | null): string | undefined {
  if (pathname === null) return undefined;
  const home = to("/");
  let best: string | undefined;
  for (const { href } of items) {
    const match = href === home ? pathname === home : pathname === href || pathname.startsWith(`${href}/`);
    if (match && (best === undefined || href.length > best.length)) best = href;
  }
  return best;
}
