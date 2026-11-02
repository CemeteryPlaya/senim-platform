"use client";

import { useState, useTransition, type FormEvent } from "react";
import { ru } from "@/i18n/ru";
import { Alert, Button, Input } from "@/ui";
import { saveContacts } from "./actions";

const t = ru.identity.contacts;
type Notice = { tone: "success" | "danger"; text: string } | null;

/** Форма Instagram: поле без «@», сохранение — Server Action; ошибки поля — под полем. */
export function ContactsForm({ initial, max }: { initial: string; max: number }) {
  const [instagram, setInstagram] = useState(initial);
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<Notice>(null);
  const [pending, startTransition] = useTransition();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setNotice(null);
    startTransition(async () => {
      const result = await saveContacts({ instagram });
      if (!result.ok) {
        setError(result.fieldErrors?.instagram?.[0]);
        setNotice({ tone: "danger", text: result.error });
        return;
      }
      setError(undefined);
      setInstagram(result.data.instagram ?? "");
      setNotice({ tone: "success", text: t.saved });
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
      <Input
        label={t.instagram}
        hint={t.instagramHint}
        value={instagram}
        onChange={(e) => setInstagram(e.target.value)}
        error={error}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        inputMode="text"
        maxLength={max + 1}
        optional
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
