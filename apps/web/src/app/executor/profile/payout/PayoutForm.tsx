"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { leaveIfSignedOut } from "@/modules/identity/client";
import { ru } from "@/i18n/ru";
import { Alert, Button, Input, useFocusInvalid } from "@/ui";
import { savePayoutIban } from "./actions";

const t = ru.identity.payout;
type Notice = { tone: "success" | "danger"; text: string } | null;

/**
 * Ввод IBAN. Поле пустое и после сохранения: полный номер не возвращается в браузер, на экране — только
 * последние 4 символа: после сохранения экран обновляется, и строка «Счёт: KZ… 0100» над формой — новая.
 */
export function PayoutForm() {
  const router = useRouter();
  const [iban, setIban] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<Notice>(null);
  const [pending, startTransition] = useTransition();
  const { ref, focusInvalid } = useFocusInvalid();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setNotice(null);
    startTransition(async () => {
      const result = await savePayoutIban({ iban });
      if (!result.ok) {
        if (leaveIfSignedOut(result)) return;
        setError(result.fieldErrors?.iban?.[0] ?? result.error);
        setNotice({ tone: "danger", text: result.error });
        // Ошибка показана у поля IBAN — фокус туда, чтобы исправить сразу.
        focusInvalid();
        return;
      }
      setError(undefined);
      setIban("");
      setNotice({ tone: "success", text: t.saved });
      router.refresh();
    });
  };

  return (
    <form ref={ref} onSubmit={submit} className="flex flex-col gap-6" noValidate>
      <Input
        label={t.iban}
        hint={t.ibanHint}
        value={iban}
        onChange={(e) => setIban(e.target.value)}
        error={error}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={40}
        className="font-mono tabular-nums"
      />
      {notice && (
        <Alert tone={notice.tone} live={notice.tone === "danger" ? "assertive" : "polite"}>
          {notice.text}
        </Alert>
      )}
      <div>
        <Button type="submit" loading={pending}>
          {t.save}
        </Button>
      </div>
    </form>
  );
}
