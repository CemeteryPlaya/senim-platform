"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { leaveIfSignedOut } from "@/modules/identity/client";
import { ru } from "@/i18n/ru";
import type { UploadPurpose } from "@/modules/files/client";
import { Alert, Button, useFocusInvalid } from "@/ui";
import { Uploader } from "../../../_components/uploader";
import { submitKyc } from "./actions";

const t = ru.identity.kyc;

const KYC_PURPOSE = { id: "KYC_ID", registration: "KYC_REGISTRATION" } as const satisfies Record<string, UploadPurpose>;

/** Загрузка удостоверения и регистрации ИП/ТОО и отправка на проверку — одно главное действие экрана. */
export function KycForm({ max }: { max: number }) {
  const router = useRouter();
  const [idFileIds, setIdFileIds] = useState<string[]>([]);
  const [registrationFileIds, setRegistrationFileIds] = useState<string[]>([]);
  const [busy, setBusy] = useState({ id: false, registration: false });
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const { ref, focusInvalid } = useFocusInvalid();
  const uploading = busy.id || busy.registration;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (uploading) return;
    setNotice(null);
    startTransition(async () => {
      const result = await submitKyc({ idFileIds, registrationFileIds });
      if (!result.ok) {
        if (leaveIfSignedOut(result)) return;
        setErrors(result.fieldErrors ?? {});
        setNotice({ tone: "danger", text: result.error });
        // Нет удостоверения или регистрации — фокус на загрузку, которой не хватает.
        if (result.fieldErrors) focusInvalid();
        return;
      }
      setErrors({});
      setNotice({ tone: "success", text: t.submitted });
      router.refresh();
    });
  };

  return (
    <form ref={ref} onSubmit={submit} className="flex flex-col gap-6" noValidate>
      <Uploader
        purpose={KYC_PURPOSE.id}
        label={t.idLabel}
        hint={t.idHint}
        max={max}
        error={errors.idFileIds?.[0]}
        onChange={setIdFileIds}
        onBusyChange={(b) => setBusy((prev) => ({ ...prev, id: b }))}
      />
      <Uploader
        purpose={KYC_PURPOSE.registration}
        label={t.registrationLabel}
        hint={t.registrationHint}
        max={max}
        error={errors.registrationFileIds?.[0]}
        onChange={setRegistrationFileIds}
        onBusyChange={(b) => setBusy((prev) => ({ ...prev, registration: b }))}
      />
      {notice && (
        <Alert tone={notice.tone} live={notice.tone === "danger" ? "assertive" : "polite"}>
          {notice.text}
        </Alert>
      )}
      {/* loading, а не disabled: кнопка не теряет фокус, а причина ожидания — в описании кнопки. */}
      <div className="flex flex-col gap-2">
        <Button type="submit" loading={pending || uploading} aria-describedby="kyc-wait" className="self-start">
          {t.submit}
        </Button>
        <p id="kyc-wait" className="text-base text-ink-soft" aria-live="polite">
          {uploading ? t.waitUploads : ""}
        </p>
      </div>
    </form>
  );
}
