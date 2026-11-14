"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { PHOTO_ACCEPT } from "@/features/upload/transfer";
import { ru } from "@/i18n/ru";
import { ActionDock, Button, Card, Explain, Stack, toast, Uploader } from "@/kit";
import type { Device } from "@/platform/device";
import { FormError } from "../../../../_shell/FormError";
import { useActionForm } from "../../../../_shell/form";
import { to } from "../../../../_shell/paths";
import { usePhotoUploads } from "../../../_upload/usePhotoUploads";
import { submitKycAction } from "./actions";
import { documentItems, KYC_MAX } from "./kyc-view";

const t = ru.app.masterCompany.kyc.form;
const FORM = "kyc-form";
/** Фото и PDF: свидетельство ИП и справка ТОО с eGov приходят PDF. */
const ACCEPT = `${PHOTO_ACCEPT},application/pdf,.pdf`;

/** Ошибка раздела загрузки: тот же вид, что у полей kit. */
function SectionError({ children }: { children: string | undefined }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-sub text-danger">
      {children}
    </p>
  );
}

/**
 * Загрузка удостоверения и документа о регистрации (фото или PDF, до 4 в каждом разделе; на телефоне — ещё «Снять на
 * камеру»). «Отправить на проверку» — главное действие экрана (док на телефоне): пока файлы грузятся, отправка ждёт.
 * Ошибки — у раздела; после отправки — тост и возврат на экран без формы (документы на проверке).
 */
export function KycForm({ device }: { device: Device }) {
  const router = useRouter();
  const ids = usePhotoUploads("KYC_ID", [], t.photoName);
  const registration = usePhotoUploads("KYC_REGISTRATION", [], t.photoName);
  const [errors, setErrors] = useState<{ idFileIds?: string; registrationFileIds?: string }>({});
  const [done, setDone] = useState(false);
  const form = useActionForm(submitKycAction, {
    toInput: () => ({ idFileIds: ids.fileIds, registrationFileIds: registration.fileIds }),
    onSuccess: () => {
      setDone(true);
      toast(t.submitted);
      router.replace(to("/executor/profile/kyc"));
      router.refresh();
    },
  });
  const shown = { ...errors, ...form.fieldErrors };

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (ids.busy || registration.busy) {
      toast(t.uploading);
      return;
    }
    const next = {
      ...(ids.fileIds.length === 0 ? { idFileIds: t.errors.needId } : {}),
      ...(registration.fileIds.length === 0 ? { registrationFileIds: t.errors.needRegistration } : {}),
    };
    setErrors(next);
    if (Object.keys(next).length === 0) void form.submit(new FormData());
  }

  const reject = (_files: File[], why: "type" | "limit") => toast.error(why === "type" ? t.rejectType : t.rejectLimit(KYC_MAX));

  return (
    <>
      <Card>
        <form id={FORM} method="post" onSubmit={submit} noValidate>
          <Stack gap="section">
            <Stack>
              <p className="text-sub font-medium text-ink">{t.id}</p>
              <Uploader
                items={documentItems(ids.items)}
                max={KYC_MAX}
                accept={ACCEPT}
                capture="environment"
                label={t.add}
                onAdd={ids.add}
                onRemove={ids.remove}
                onRetry={ids.retry}
                onReject={reject}
              />
              <SectionError>{shown.idFileIds}</SectionError>
            </Stack>
            <Stack>
              <p className="text-sub font-medium text-ink">{t.registration}</p>
              <Uploader
                items={documentItems(registration.items)}
                max={KYC_MAX}
                accept={ACCEPT}
                capture="environment"
                label={t.add}
                onAdd={registration.add}
                onRemove={registration.remove}
                onRetry={registration.retry}
                onReject={reject}
              />
              <SectionError>{shown.registrationFileIds}</SectionError>
            </Stack>
            <div>
              <Explain label={t.explain.label} title={t.explain.title} device={device}>
                {t.explain.points.map((point) => (
                  <p key={point} className="mb-2 last:mb-0">
                    {point}
                  </p>
                ))}
              </Explain>
            </div>
            <FormError error={form.error} atField={Boolean(shown.idFileIds || shown.registrationFileIds)} />
          </Stack>
        </form>
      </Card>
      <ActionDock>
        <Button type="submit" form={FORM} disabled={done} pending={form.pending}>
          {t.submit}
        </Button>
      </ActionDock>
    </>
  );
}
