"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import type { ConsentDocument } from "@/i18n/ru/consent";
import { leaveIfSignedOut } from "@/modules/identity/client";
import { ru } from "@/i18n/ru";
import { Alert, Button, FullscreenStep } from "@/ui";
import { ConsentText } from "../_components/consent/ConsentText";
import { logoutAction } from "../_components/auth/actions";
import { LogoutButton } from "../_components/auth/LogoutButton";
import { grantConsentAction } from "./actions";

const t = ru.consent.screen;

/**
 * Экран согласия — полноэкранный шаг: текст текущей редакции, одна главная кнопка «Даю согласие»; «Выйти» — второстепенная
 * под ней. next — куда вернуться после согласия (проверяет сервер). updated — у человека было согласие прежней редакции.
 * Сервер получает редакцию, которую человек видел: текст сменился между показом и нажатием — ошибка «текст обновился» и
 * экран перерисовывается с новой редакцией. «Назад» — выход (как на второй ступени оператора): без согласия любая
 * страница вернула бы сюда.
 */
export function ConsentForm({ next, updated, document: doc }: { next: string | null; updated: boolean; document: ConsentDocument }) {
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(undefined);
    startTransition(async () => {
      // При успехе действие ведёт дальше (redirect) — сюда возвращается только ошибка.
      const res = await grantConsentAction({ next, version: doc.version });
      if (res.ok || leaveIfSignedOut(res)) return;
      setError(res.error);
      if (res.code === "CONFLICT") router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <FullscreenStep
        title={doc.title}
        back={{ onClick: () => startTransition(async () => void (await logoutAction({ everywhere: false }))) }}
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
