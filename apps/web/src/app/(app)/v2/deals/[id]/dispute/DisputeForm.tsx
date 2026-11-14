"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ru } from "@/i18n/ru";
import { ActionDock, Button, Card, ConfirmDialog, Explain, Narrow, NowNext, PageTitle, RadioCard, RadioGroup, Stack, TextArea, toast, Uploader } from "@/kit";
import { PHOTO_ACCEPT } from "@/features/upload/transfer";
import type { Device } from "@/platform/device";
import { FormError } from "../../../../_shell/FormError";
import { useActionForm } from "../../../../_shell/form";
import { usePhotoUploads } from "../../../_upload/usePhotoUploads";
import { openDisputeAction } from "./actions";
import { MAX_PHOTOS, TEXT_MAX, textValid } from "./dispute-view";

const t = ru.app.deal.dispute.form;
const FORM = "dispute-form";
const REASONS = Object.keys(ru.app.deal.dispute.reasons);

type Props = { dealId: string; dealTitle: string; backHref: string; device: Device };

/**
 * Форма «Открыть спор»: причина (радио), описание (обязательное), фото (по желанию), пояснение «Что будет дальше».
 * «Открыть спор» сперва проверяет поля, потом спрашивает подтверждение с точным текстом последствий и только тогда
 * вызывает действие. Двойное нажатие: окно не принимает второй клик, форма не отправляется повторно, а модуль даёт
 * один спор на сделку. После успеха — тост и возврат на карточку сделки.
 */
export function DisputeForm({ dealId, dealTitle, backHref, device }: Props) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<{ reason?: string; description?: string }>({});
  const [confirm, setConfirm] = useState(false);
  const [done, setDone] = useState(false);
  const uploads = usePhotoUploads("DISPUTE", [], t.photoName);
  const form = useActionForm(openDisputeAction, {
    // Значения держит состояние формы; схема действия на сервере проверяет причину и тексты.
    toInput: () => ({ dealId, reason: reason as "OTHER", description, photoIds: uploads.fileIds }),
    onSuccess: () => {
      setDone(true);
      toast(t.opened);
      router.replace(backHref);
    },
  });
  const fieldErrors = { ...errors, ...form.fieldErrors };

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (uploads.busy) {
      toast(t.uploading);
      return;
    }
    const next = { ...(reason ? {} : { reason: t.errors.reason }), ...(textValid(description) ? {} : { description: t.errors.description }) };
    setErrors(next);
    if (Object.keys(next).length === 0) setConfirm(true);
  }

  async function open(): Promise<boolean> {
    await form.submit(new FormData());
    return true;
  }

  return (
    <Narrow>
      <Stack gap="section">
        <PageTitle title={t.title} back={{ href: backHref, label: dealTitle }} lead={t.lead} />
        <NowNext now={{ title: t.nowTitle }} next={t.nowNext} />
        <Card>
          <form id={FORM} method="post" onSubmit={submit} noValidate>
            <Stack gap="section">
              <RadioGroup legend={t.reasonLegend} {...(fieldErrors.reason ? { error: fieldErrors.reason } : {})}>
                {REASONS.map((key) => (
                  <RadioCard key={key} name="reason" value={key} label={ru.app.deal.dispute.reasons[key] ?? key} checked={reason === key} onChange={() => setReason(key)} />
                ))}
              </RadioGroup>
              <TextArea
                label={t.descriptionLabel}
                name="description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={TEXT_MAX}
                rows={5}
                {...(fieldErrors.description ? { error: fieldErrors.description } : {})}
              />
              <Stack>
                <p className="text-sub font-medium text-ink">{t.photosTitle}</p>
                <p className="text-sub text-muted">{t.photosLead}</p>
                <Uploader
                  items={uploads.items}
                  max={MAX_PHOTOS}
                  accept={PHOTO_ACCEPT}
                  label={t.addPhoto}
                  onAdd={uploads.add}
                  onRemove={uploads.remove}
                  onRetry={uploads.retry}
                  onReject={(_files, why) => toast.error(why === "type" ? t.rejectType : t.rejectLimit(MAX_PHOTOS))}
                />
              </Stack>
              <FormError error={form.error} />
            </Stack>
          </form>
        </Card>
        <div>
          <Explain label={t.explain.label} title={t.explain.title} device={device}>
            {t.explain.points.map((point) => (
              <p key={point} className="mb-2 last:mb-0">
                {point}
              </p>
            ))}
          </Explain>
        </div>
        <ActionDock>
          <Button type="submit" form={FORM} disabled={done} pending={form.pending}>
            {t.submit}
          </Button>
        </ActionDock>
        <ConfirmDialog
          device={device}
          tone="danger"
          open={confirm}
          onOpenChange={setConfirm}
          title={t.confirm.title}
          description={t.confirm.body}
          confirmLabel={t.confirm.confirm}
          cancelLabel={t.confirm.cancel}
          onConfirm={open}
        />
      </Stack>
    </Narrow>
  );
}
