"use client";

import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { isLegacyRoute } from "./legacy-routes";
import { MovingPlaceholder } from "./Moving";
import { isOperatorReady } from "./operator-sections";
import { legacy, to } from "./paths";

/**
 * Оператор в v2, пока разделы переносятся (этап 5): на готовых экранах (`OPERATOR_READY`) — сама страница, на остальных —
 * заглушка со ссылкой на тот же адрес в v1 (с параметрами), если такой экран в v1 есть; на неизвестном адресе — сама
 * страница («Страница не найдена»). Адрес знает только клиентский роутер, поэтому компонент
 * клиентский; рисует его layout вокруг страницы. Это только интерфейс, а не граница доступа: страница выполняется на
 * сервере в любом случае, права проверяют она сама и действия сервера.
 */
export function OperatorMoving({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? to("/");
  const query = useSearchParams()?.toString() ?? "";
  if (isOperatorReady(pathname) || !isLegacyRoute(legacy(pathname))) return children;
  return <MovingPlaceholder href={legacy(pathname) + (query ? `?${query}` : "")} />;
}
