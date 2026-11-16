"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { navMemory, visit } from "./back-nav";

function Tracker() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const address = search ? `${pathname}?${search}` : pathname;
  useEffect(() => {
    navMemory.write(visit(navMemory.read(), address));
  }, [address]);
  return null;
}

/**
 * Запоминает, с какого адреса (путь и параметры) пришли, для «‹ Назад» (BackLink): по смене адреса переносит текущий в
 * «предыдущий». Ничего не рисует; одна на оболочку. Suspense — `useSearchParams` требует границы.
 */
export function NavHistory() {
  return (
    <Suspense fallback={null}>
      <Tracker />
    </Suspense>
  );
}
