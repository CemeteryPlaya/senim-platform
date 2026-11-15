"use client";

import { LogIn, Plus } from "lucide-react";
import { usePathname } from "next/navigation";
import { ButtonLink } from "@/kit";
import { type AppNav, visibleAction } from "./nav";
import { to } from "./paths";

/**
 * Действие справа в шапке компьютера: тихая кнопка (ink, без заливки; наведение — fill) со значком 16 px слева — «+» у
 * «Заказать мебель», вход у «Войти». Не капсула с заливкой: заливка-капсула в шапке — только «линза» активного раздела,
 * и действие с ней не путается. Главная кнопка принадлежит экрану. На экранах входа «Войти» скрыто (visibleAction).
 */
export function ShellAction({ action }: { action: AppNav["action"] }) {
  const shown = visibleAction(action, usePathname());
  if (!shown) return null;
  const Icon = shown.href === to("/login") ? LogIn : Plus;
  return (
    <ButtonLink href={shown.href} variant="quiet" size="sm">
      <Icon aria-hidden data-shell-action-icon className="size-4 shrink-0" strokeWidth={2} />
      {shown.label}
    </ButtonLink>
  );
}
