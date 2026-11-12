"use client";

import { LogIn } from "lucide-react";
import { useState, useTransition } from "react";
import type { Role } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { Alert, Button } from "@/ui";
import { loginAsPersonaAction } from "./actions";

/**
 * «Войти» за демо-персону: одно нажатие, ошибка — под кнопкой.
 * next, label и role — для шагов показа банку: войти в роли шага и сразу открыть его экран.
 */
export function PersonaButton({ userId, name, next, label, role }: { userId: string; name: string; next?: string; label?: string; role?: Role }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  return (
    <div className="flex flex-col gap-2">
      <Button
        variant={next ? "secondary" : "soft"}
        fullWidth={!next}
        icon={<LogIn />}
        loading={pending}
        aria-label={label ? undefined : ru.identity.demo.signInAs(name)}
        onClick={() =>
          startTransition(async () => {
            setError(undefined);
            const res = await loginAsPersonaAction({ userId, next, role });
            if (!res.ok) setError(res.error);
          })
        }
      >
        {label ?? ru.common.nav.login}
      </Button>
      {error && (
        <Alert tone="danger" live="assertive">
          {error}
        </Alert>
      )}
    </div>
  );
}
