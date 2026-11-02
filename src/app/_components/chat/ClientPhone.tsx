"use client";

import { Phone } from "lucide-react";
import { useState, useTransition } from "react";
import { ru } from "@/i18n/ru";
import type { ClientPhoneView } from "@/modules/companies";
import { buttonClasses, ConfirmButton } from "@/ui";
import { revokeClientPhoneAction, shareClientPhoneAction } from "./actions";

const t = ru.companies.chat.phone;

type Props = { offerId: string; view: NonNullable<ClientPhoneView>; onChanged: () => Promise<void> };

/**
 * Телефон заказчика в чате отклика (ответ №21, ADR-008). Исполнителю — номер ссылкой tel:, пока
 * заказчик его показывает; заказчику — неброская строка «Показать мой телефон исполнителю» с
 * подтверждением или «Скрыть телефон». Что показывать, решает companies.getChat (view).
 */
export function ClientPhone({ offerId, view, onChanged }: Props) {
  if (view.for === "executor") {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-sm text-muted">{t.executorLabel}</p>
        <a href={`tel:${view.phone}`} className={buttonClasses({ variant: "soft", className: "self-start" })}>
          <Phone aria-hidden className="size-5" />
          {view.display}
        </a>
      </div>
    );
  }
  return <ClientToggle offerId={offerId} shared={view.shared} onChanged={onChanged} />;
}

function ClientToggle({ offerId, shared, onChanged }: { offerId: string; shared: boolean; onChanged: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = () =>
    startTransition(async () => {
      setError(null);
      const result = await (shared ? revokeClientPhoneAction : shareClientPhoneAction)({ offerId });
      if (!result.ok) setError(result.error);
      await onChanged();
    });

  return (
    <div className="flex flex-col items-start gap-1" aria-live="polite">
      {shared && <p className="text-muted">{t.shared}</p>}
      <ConfirmButton
        variant="ghost"
        onRun={run}
        pending={pending}
        error={error}
        confirm={shared ? undefined : { title: t.confirmTitle, text: t.confirmText, yes: t.confirmYes, no: ru.common.actions.cancel, tone: "primary" }}
      >
        {shared ? t.revoke : t.share}
      </ConfirmButton>
    </div>
  );
}
