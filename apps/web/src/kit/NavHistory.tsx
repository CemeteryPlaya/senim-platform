"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { navMemory, visit } from "./back-nav";

/**
 * Запоминает, с какого экрана пришли (для «‹ Назад», BackLink): по смене пути переносит текущий в «предыдущий». Ничего не
 * рисует; одна на оболочку.
 */
export function NavHistory() {
  const pathname = usePathname();
  useEffect(() => {
    navMemory.write(visit(navMemory.read(), pathname));
  }, [pathname]);
  return null;
}
