"use client";

import { LogOut } from "lucide-react";
import { useTransition } from "react";
import { ru } from "@/i18n/ru";
import { Button, type ButtonVariant } from "@/ui";
import { logoutAction } from "./actions";

export type LogoutButtonProps = {
  /** Отозвать сессии на всех устройствах, а не только в этом браузере. */
  everywhere?: boolean;
  variant?: ButtonVariant;
  fullWidth?: boolean;
  className?: string;
};

/**
 * Кнопка «Выйти». После выхода сервер ведёт на главную.
 * Пример: `{user && <LogoutButton variant="ghost" />}` в шапке; `<LogoutButton everywhere variant="secondary" />` в профиле.
 */
export function LogoutButton({ everywhere = false, variant = "ghost", fullWidth, className }: LogoutButtonProps) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant={variant}
      fullWidth={fullWidth}
      className={className}
      icon={<LogOut />}
      loading={pending}
      onClick={() => startTransition(async () => void (await logoutAction({ everywhere })))}
    >
      {everywhere ? ru.identity.logout.everywhere : ru.identity.logout.action}
    </Button>
  );
}
