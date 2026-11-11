"use client";

import { ru } from "@/i18n/ru";
import { ConfirmButton } from "@/ui";
import { useRunAction } from "@/app/deals/_parts/useRunAction";
import { revokeConsentAction } from "./actions";

const t = ru.consent.revoke;

/**
 * «Отозвать согласие» с подтверждением: последствия — из ru (срок 15 рабочих дней, согласие действует до решения, что
 * сохраняется). После заявки экран обновляется и показывает её статус и срок; на экран согласия человек не уходит.
 */
export function RevokeForm() {
  const { run, pending, error } = useRunAction(revokeConsentAction);
  return (
    <ConfirmButton
      variant="danger"
      fullWidth
      pending={pending}
      error={error}
      onRun={() => run({})}
      confirm={{ title: t.confirmTitle, text: t.consequences, yes: t.confirm, no: t.cancel, tone: "danger" }}
    >
      {t.action}
    </ConfirmButton>
  );
}
