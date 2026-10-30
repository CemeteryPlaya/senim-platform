"use client";

import { LogIn } from "lucide-react";
import { useState, useTransition } from "react";
import { ru } from "@/i18n/ru";
import { Alert, Button } from "@/ui";
import { loginAsPersonaAction } from "./actions";

/** «Войти» за демо-персону: одно нажатие, ошибка — под кнопкой. */
export function PersonaButton({ userId, name }: { userId: string; name: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="soft"
        fullWidth
        icon={<LogIn />}
        loading={pending}
        aria-label={ru.identity.demo.signInAs(name)}
        onClick={() =>
          startTransition(async () => {
            setError(undefined);
            const res = await loginAsPersonaAction({ userId });
            if (!res.ok) setError(res.error);
          })
        }
      >
        {ru.common.nav.login}
      </Button>
      {error && (
        <Alert tone="danger" live="assertive">
          {error}
        </Alert>
      )}
    </div>
  );
}
