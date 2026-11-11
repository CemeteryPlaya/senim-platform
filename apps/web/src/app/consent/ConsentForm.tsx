"use client";

import { useState, useTransition, type FormEvent } from "react";
import type { ConsentDocument } from "@/i18n/ru/consent";
import { leaveIfSignedOut } from "@/modules/identity/client";
import { ru } from "@/i18n/ru";
import { Alert, Button, FullscreenStep } from "@/ui";
import { ConsentText } from "../_components/consent/ConsentText";
import { LogoutButton } from "../_components/auth/LogoutButton";
import { grantConsentAction } from "./actions";

const t = ru.consent.screen;

/**
 * Экран согласия — полноэкранный шаг: текст текущей редакции, одна главная кнопка «Даю согласие»; «Выйти» — второстепенная
 * под ней. next — куда вернуться после согласия (проверяет сервер). updated — у человека было согласие прежней редакции.
 */
export function ConsentForm({ next, updated, document: doc }: { next: string | null; updated: boolean; document: ConsentDocument }) {
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(undefined);
    startTransition(async () => {
      // При успехе действие ведёт дальше (redirect) — сюда возвращается только ошибка.
      const res = await grantConsentAction({ next });
      if (res.ok || leaveIfSignedOut(res)) return;
      setError(res.error);
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <FullscreenStep
        title={doc.title}
        back={{ href: "/" }}
        action={
          <>
            {error && (
              <Alert tone="danger" live="assertive">
                {error}
              </Alert>
            )}
            <p className="text-base text-ink-soft">{t.acceptHint}</p>
            <Button type="submit" loading={pending} fullWidth>
              {t.accept}
            </Button>
            <LogoutButton variant="secondary" fullWidth />
          </>
        }
      >
        <p className="max-w-prose text-lg text-ink">{updated ? t.updated : t.lead}</p>
        <ConsentText document={doc} />
      </FullscreenStep>
    </form>
  );
}
