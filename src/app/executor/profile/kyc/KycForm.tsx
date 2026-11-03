"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { ru } from "@/i18n/ru";
import type { UploadPurpose } from "@/modules/files/client";
import { Alert, Button } from "@/ui";
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

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setNotice(null);
    startTransition(async () => {
      const result = await submitKyc({ idFileIds, registrationFileIds });
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        setNotice({ tone: "danger", text: result.error });
        return;
      }
      setErrors({});
      setNotice({ tone: "success", text: t.submitted });
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
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
      <div>
        <Button type="submit" loading={pending} disabled={busy.id || busy.registration}>
          {t.submit}
        </Button>
      </div>
    </form>
  );
}
