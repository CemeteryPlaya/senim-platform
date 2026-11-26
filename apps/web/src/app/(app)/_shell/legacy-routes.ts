/**
 * Экраны v1 (`src/app/(legacy)`, интерфейс заморожен): заглушка «раздел переносится» со ссылкой на v1 уместна только
 * для них. Неизвестный адрес под /v2 — «Страница не найдена», а не перенос: ссылка вела бы на 404 прежнего интерфейса.
 * Сегмент в квадратных скобках — любое значение. Список сверяет с деревом `(legacy)` тест `legacy-routes.test.ts`.
 */
export const LEGACY_ROUTES: readonly string[] = [
  "/",
  "/about",
  "/catalog",
  "/chats",
  "/consent",
  "/d/[token]",
  "/deals",
  "/deals/[id]",
  "/deals/[id]/money",
  "/executor/finance",
  "/executor/measurements",
  "/executor/offers",
  "/executor/portfolio",
  "/executor/portfolio/[id]",
  "/executor/portfolio/from-deal/[dealId]",
  "/executor/portfolio/new",
  "/executor/profile",
  "/executor/profile/kyc",
  "/executor/profile/payout",
  "/executor/requests",
  "/executor/requests/[id]",
  "/executors/[publicNumber]",
  "/inspiration",
  "/inspiration/[id]",
  "/login",
  "/measurer",
  "/measurer/[id]",
  "/notifications",
  "/operator",
  "/operator/audit",
  "/operator/consents",
  "/operator/deals",
  "/operator/deals/[id]",
  "/operator/disputes",
  "/operator/disputes/[id]",
  "/operator/executors",
  "/operator/executors/[id]",
  "/operator/executors/new",
  "/operator/furniture-types",
  "/operator/income",
  "/operator/kyc",
  "/operator/materials",
  "/operator/mfa",
  "/operator/money",
  "/operator/report",
  "/operator/requests",
  "/operator/settings",
  "/profile",
  "/profile/contacts",
  "/profile/data",
  "/register",
  "/register/executor",
  "/requests",
  "/requests/[id]",
  "/requests/[id]/offers/[offerId]",
  "/requests/new",
  "/switch-role",
  "/ui-kit",
  "/welcome",
];

const segments = (path: string): string[] => path.split("/").filter(Boolean);

const ROUTES = LEGACY_ROUTES.map(segments);

/** Есть ли в v1 экран по этому адресу (путь v1 без префикса v2 и без строки запроса; пустые сегменты не считаются). */
export function isLegacyRoute(path: string): boolean {
  const parts = segments(path);
  return ROUTES.some(
    (route) => route.length === parts.length && route.every((segment, i) => (segment.startsWith("[") && segment.endsWith("]")) || segment === parts[i]),
  );
}
