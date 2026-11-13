"use client";

import { useTransition } from "react";
import { ru } from "@/i18n/ru";
import { Button, toast } from "@/kit";
import { logout } from "./session-actions";

/**
 * Тихая кнопка «Выйти» для экранов первых шагов (согласие, знакомство): выйти можно всегда. После выхода действие ведёт
 * на вход v2; сбой выхода (identity недоступен) — тостом, как в меню профиля. Ставится в `ActionDock` рядом с главной кнопкой.
 */
export function LogoutButton() {
  const [pending, startTransition] = useTransition();
  const signOut = () =>
    startTransition(async () => {
      const res = await logout({});
      if (!res.ok) toast.error(res.error);
    });
  return (
    <Button variant="quiet" pending={pending} onClick={signOut}>
      {ru.app.shell.logout}
    </Button>
  );
}
