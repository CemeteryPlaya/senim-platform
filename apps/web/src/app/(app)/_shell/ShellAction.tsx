"use client";

import { usePathname } from "next/navigation";
import { ButtonLink } from "@/kit";
import { type AppNav, visibleAction } from "./nav";

/** Действие справа в шапке компьютера (вторичная кнопка); на экранах входа «Войти» скрыто (visibleAction). */
export function ShellAction({ action }: { action: AppNav["action"] }) {
  const shown = visibleAction(action, usePathname());
  if (!shown) return null;
  return (
    <ButtonLink href={shown.href} variant="secondary" size="sm">
      {shown.label}
    </ButtonLink>
  );
}
