import type { Role } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";

// Навигация оболочки по макетам 7–19: у каждой роли — вкладки нижней панели (телефон) и верхнего меню
// (компьютер) и остальные разделы — в профиле и «Ещё». Маршруты — по таблице владения в
// docs/agents/PHASE_B_RULES.md. Иконка — ключ, компонент выбирает ShellNav.

export type NavIcon =
  | "home"
  | "catalog"
  | "inspiration"
  | "requests"
  | "deals"
  | "orders"
  | "finance"
  | "notifications"
  | "incoming"
  | "measurements"
  | "account"
  | "company"
  | "portfolio"
  | "operator"
  | "bank"
  | "demo";

export type NavItem = { href: string; label: string; icon: NavIcon };

/** Вкладки — на виду всегда; more — в «Ещё» на компьютере и списком на странице профиля. */
export type RoleNav = { tabs: NavItem[]; more: NavItem[] };

/** Ровно то, что нужно навигации от текущего пользователя (подмножество CurrentUser). */
export type NavUser = {
  role: Role;
  executor: { status: "PENDING" | "APPROVED" | "REJECTED" } | null;
};

const t = ru.common.nav;

/** Страница профиля: аккаунт, роль, установка приложения, «Выйти» и разделы, которых нет во вкладках. */
export const ACCOUNT_HREF = "/profile";
/** Адрес входа: кнопка «Войти» в шапке для гостя. */
export const LOGIN_HREF = "/login";

const ROUTES = {
  home: { href: "/", label: t.home, icon: "home" },
  catalog: { href: "/catalog", label: t.catalog, icon: "catalog" },
  // Ленту «Вдохновение» делает другой агент (companies); здесь — только пункт меню.
  inspiration: { href: "/inspiration", label: t.inspiration, icon: "inspiration" },
  myRequests: { href: "/requests", label: t.myRequests, icon: "requests" },
  deals: { href: "/deals", label: t.deals, icon: "deals" },
  orders: { href: "/deals", label: t.orders, icon: "orders" },
  finance: { href: "/executor/finance", label: t.finance, icon: "finance" },
  notifications: { href: "/notifications", label: t.notifications, icon: "notifications" },
  incoming: { href: "/executor/requests", label: t.incoming, icon: "incoming" },
  measurements: { href: "/executor/measurements", label: t.measurements, icon: "measurements" },
  account: { href: ACCOUNT_HREF, label: t.account, icon: "account" },
  company: { href: "/executor/profile", label: t.company, icon: "company" },
  portfolio: { href: "/executor/portfolio", label: t.portfolio, icon: "portfolio" },
  operator: { href: "/operator", label: t.operator, icon: "operator" },
  measurer: { href: "/measurer", label: t.measurer, icon: "measurements" },
  bankDemo: { href: "/bank-demo", label: t.bankDemo, icon: "bank" },
  demo: { href: "/demo", label: t.demo, icon: "demo" },
} satisfies Record<string, NavItem>;

const R = ROUTES;

function roleNav(user: NavUser | null): RoleNav {
  if (!user) return { tabs: [R.home, R.catalog, R.inspiration], more: [] };
  switch (user.role) {
    case "CLIENT":
      return { tabs: [R.home, R.myRequests, R.inspiration, R.account], more: [R.deals, R.catalog, R.notifications] };
    case "EXECUTOR":
      return user.executor?.status === "APPROVED"
        ? { tabs: [R.home, R.incoming, R.orders, R.finance, R.account], more: [R.measurements, R.company, R.portfolio, R.notifications] }
        : { tabs: [R.company, R.portfolio, R.account], more: [R.notifications] };
    case "OPERATOR":
      return { tabs: [R.operator, R.deals, R.account], more: [] };
    case "MEASURER":
      return { tabs: [R.measurer, R.account], more: [R.notifications] };
  }
}

/**
 * Меню пользователя (null — гость). Вкладки — в порядке макетов; демо-пункты — только при DEMO_MODE
 * и всегда в «Ещё»: показ банку — любой роли, ведущий переключает персоны по ходу показа.
 */
export function navFor(user: NavUser | null, demoMode: boolean): RoleNav {
  const nav = roleNav(user);
  return { tabs: [...nav.tabs], more: demoMode ? [...nav.more, R.bankDemo, R.demo] : [...nav.more] };
}

/** Насколько пункт подходит к адресу: -1 — не подходит; больше — точнее (длиннее путь, совпал параметр). */
function matchScore(item: NavItem, pathname: string, search: URLSearchParams): number {
  const url = new URL(item.href, "http://x");
  const path = url.pathname;
  const pathOk = path === "/" ? pathname === "/" : pathname === path || pathname.startsWith(`${path}/`);
  if (!pathOk) return -1;
  for (const [key, value] of url.searchParams) if (search.get(key) !== value) return -1;
  return path.length * 10 + url.searchParams.size;
}

/**
 * Активный пункт меню для адреса (для aria-current="page"): самый точный из подходящих (длиннее путь, совпал
 * параметр адреса); «/» подсвечивается только на самой главной.
 */
export function currentItem<T extends NavItem>(items: readonly T[], pathname: string, search: URLSearchParams): T | undefined {
  let best: T | undefined;
  let bestScore = -1;
  for (const item of items) {
    const score = matchScore(item, pathname, search);
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Делит пункты на видимые сразу и спрятанные в «Ещё», когда ячеек меньше, чем пунктов.
 * withMore — «Ещё» нужен в любом случае (есть что положить туда помимо этих пунктов): под него уходит одна ячейка.
 */
export function splitNav<T>(items: readonly T[], cells: number, withMore = false): { shown: readonly T[]; more: readonly T[] } {
  if (items.length <= cells && !withMore) return { shown: items, more: [] };
  return { shown: items.slice(0, cells - 1), more: items.slice(cells - 1) };
}
