"use client";

import { useState, useTransition, type FormEvent } from "react";
import { ru } from "@/i18n/ru";
import { Alert, Button, Input } from "@/ui";
import { saveContacts } from "./actions";

const t = ru.identity.contacts;
type Notice = { tone: "success" | "danger"; text: string } | null;

type Errors = { instagram?: string; email?: string };

/** Форма Instagram (без «@») и e-mail: сохранение — Server Action; ошибки полей — под полями. */
export function ContactsForm({ initial, max }: { initial: { instagram: string; email: string }; max: number }) {
  const [instagram, setInstagram] = useState(initial.instagram);
  const [email, setEmail] = useState(initial.email);
  const [errors, setErrors] = useState<Errors>({});
  const [notice, setNotice] = useState<Notice>(null);
  const [pending, startTransition] = useTransition();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setNotice(null);
    startTransition(async () => {
      const result = await saveContacts({ instagram, email });
      if (!result.ok) {
        setErrors({ instagram: result.fieldErrors?.instagram?.[0], email: result.fieldErrors?.email?.[0] });
        setNotice({ tone: "danger", text: result.error });
        return;
      }
      setErrors({});
      setInstagram(result.data.instagram ?? "");
      setEmail(result.data.email ?? "");
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
        error={errors.instagram}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        inputMode="text"
        maxLength={max + 1}
        optional
      />
      <Input
        label={t.email}
        hint={t.emailHint}
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={errors.email}
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        inputMode="email"
        maxLength={254}
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
