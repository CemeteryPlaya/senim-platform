"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { MovingPlaceholder } from "./Moving";
import { legacy, to } from "./paths";

/**
 * Оператор в v2 до своей оболочки (этап 5): вместо любой страницы v2 — заглушка со ссылкой на тот же адрес в v1
 * (с параметрами). Адрес знает только клиентский роутер, поэтому компонент клиентский; рисует его layout.
 */
export function OperatorMoving() {
  const pathname = usePathname() ?? to("/");
  const query = useSearchParams()?.toString() ?? "";
  return <MovingPlaceholder href={legacy(pathname) + (query ? `?${query}` : "")} />;
}
