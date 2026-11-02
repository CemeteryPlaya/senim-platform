"use client";

import { Repeat, ShoppingBag } from "lucide-react";
import { useState, useTransition, type ReactNode } from "react";
import { ru } from "@/i18n/ru";
import { Alert, Button, type ButtonVariant } from "@/ui";
import { becomeClientAction, switchRoleAction } from "./actions";

type Switchable = "CLIENT" | "EXECUTOR";

/** Кнопка с серверным действием и ошибкой под ней (сервер ведёт дальше сам через redirect). */
function ActionButton(props: { label: string; icon: ReactNode; variant: ButtonVariant; fullWidth?: boolean; run: () => Promise<{ ok: true } | { ok: false; error: string }> }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant={props.variant}
        fullWidth={props.fullWidth}
        icon={props.icon}
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            setError(undefined);
            const res = await props.run();
            if (!res.ok) setError(res.error);
          })
        }
      >
        {props.label}
      </Button>
      {error && (
        <Alert tone="danger" live="assertive">
          {error}
        </Alert>
      )}
    </div>
  );
}

/**
 * «Перейти в роль …». returnTo — куда вернуться после переключения (страница, которая требовала роль);
 * без него — главная выбранной роли.
 * Пример: `<SwitchRoleButton role="EXECUTOR" returnTo="/executor/requests" fullWidth />`.
 */
export function SwitchRoleButton({ role, returnTo, variant = "primary", fullWidth }: { role: Switchable; returnTo?: string; variant?: ButtonVariant; fullWidth?: boolean }) {
  return (
    <ActionButton
      label={ru.identity.switchRole.action(ru.common.roles[role])}
      icon={<Repeat />}
      variant={variant}
      fullWidth={fullWidth}
      run={() => switchRoleAction({ role, returnTo })}
    />
  );
}

/** «Стать заказчиком» в профиле исполнителя. */
export function BecomeClientButton({ variant = "secondary", fullWidth }: { variant?: ButtonVariant; fullWidth?: boolean }) {
  return <ActionButton label={ru.identity.becomeClient.action} icon={<ShoppingBag />} variant={variant} fullWidth={fullWidth} run={() => becomeClientAction({})} />;
}
