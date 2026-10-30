import type { Role } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";

// Навигация оболочки. Маршруты — по таблице владения в docs/agents/PHASE_B_RULES.md;
// страницы делают агенты фазы B. Иконка — ключ, компонент выбирает ShellNav.

export type NavIcon =
  | "catalog"
  | "requests"
  | "deals"
  | "notifications"
  | "incoming"
  | "measurements"
  | "profile"
  | "portfolio"
  | "operator"
  | "bank"
  | "demo";

export type NavItem = { href: string; label: string; icon: NavIcon };

/** Ровно то, что нужно навигации от текущего пользователя (подмножество CurrentUser). */
export type NavUser = {
  role: Role;
  executor: { status: "PENDING" | "APPROVED" | "REJECTED" } | null;
};

const t = ru.common.nav;

const ROUTES = {
  catalog: { href: "/catalog", label: t.catalog, icon: "catalog" },
  myRequests: { href: "/requests", label: t.myRequests, icon: "requests" },
  deals: { href: "/deals", label: t.deals, icon: "deals" },
  notifications: { href: "/notifications", label: t.notifications, icon: "notifications" },
  incoming: { href: "/executor/requests", label: t.incoming, icon: "incoming" },
  measurements: { href: "/executor/measurements", label: t.measurements, icon: "measurements" },
  profile: { href: "/executor/profile", label: t.profile, icon: "profile" },
  portfolio: { href: "/executor/portfolio", label: t.portfolio, icon: "portfolio" },
  operator: { href: "/operator", label: t.operator, icon: "operator" },
  bankDemo: { href: "/bank-demo", label: t.bankDemo, icon: "bank" },
  demo: { href: "/demo", label: t.demo, icon: "demo" },
} satisfies Record<string, NavItem>;

/** Адрес входа: кнопка «Войти» в шапке для гостя. */
export const LOGIN_HREF = "/login";

function itemsFor(user: NavUser | null): NavItem[] {
  if (!user) return [ROUTES.catalog];
  switch (user.role) {
    case "CLIENT":
      return [ROUTES.myRequests, ROUTES.catalog, ROUTES.deals, ROUTES.notifications];
    case "EXECUTOR":
      return user.executor?.status === "APPROVED"
        ? [ROUTES.incoming, ROUTES.measurements, ROUTES.deals, ROUTES.notifications, ROUTES.profile, ROUTES.portfolio]
        : [ROUTES.profile, ROUTES.portfolio, ROUTES.notifications];
    case "OPERATOR":
      return [ROUTES.operator];
  }
}

/**
 * Пункты меню для пользователя (null — гость), в порядке важности: на телефоне первые
 * пункты попадают в нижнюю панель, остальные — в «Ещё». Демо-пункты — только при DEMO_MODE.
 */
export function navFor(user: NavUser | null, demoMode: boolean): NavItem[] {
  const items = itemsFor(user);
  if (demoMode && user?.role === "OPERATOR") items.push(ROUTES.bankDemo);
  if (demoMode) items.push(ROUTES.demo);
  return items;
}
