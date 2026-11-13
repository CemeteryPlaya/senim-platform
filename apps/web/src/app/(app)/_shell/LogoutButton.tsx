"use client";

import { useTransition } from "react";
import { ru } from "@/i18n/ru";
import { Button, toast } from "@/kit";
import { logout } from "./session-actions";

/**
 * Кнопка «Выйти» в шапке сосредоточенной оболочки (первые шаги: согласие, знакомство): выйти можно всегда. После выхода
 * действие ведёт на вход v2; сбой выхода (identity недоступен) — тостом, как в меню профиля. Не главное действие экрана:
 * вид `quiet` (телефон) или `secondary` (компьютер) — решает оболочка.
 */
export function LogoutButton({ variant = "quiet" }: { variant?: "quiet" | "secondary" }) {
  const [pending, startTransition] = useTransition();
  const signOut = () =>
    startTransition(async () => {
      const res = await logout({});
      if (!res.ok) toast.error(res.error);
    });
  return (
    <Button variant={variant} size={variant === "secondary" ? "sm" : "md"} pending={pending} onClick={signOut}>
      {ru.app.shell.logout}
    </Button>
  );
}
