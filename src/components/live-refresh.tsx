"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Подтягивает действия второй стороны: заказчик и мастер видят изменения друг друга без перезагрузки. */
export function LiveRefresh({ interval = 4000 }: { interval?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, interval);
    return () => clearInterval(id);
  }, [router, interval]);
  return null;
}
