"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { PHOTO_ACCEPT } from "@/features/upload/transfer";
import { ru } from "@/i18n/ru";
import { ActionDock, Button, Card, Stack, TextArea, TextField, toast, Uploader } from "@/kit";
import { FormError } from "../../../../_shell/FormError";
import { useClientKey } from "../../../../_shell/client-key";
import { useActionForm } from "../../../../_shell/form";
import { LeaveGuard } from "../../../../_shell/LeaveGuard";
import type { Device } from "@/platform/device";
import { usePhotoUploads } from "../../../_upload/usePhotoUploads";
import { progressReportAction } from "./actions";

const t = ru.app.masterSteps.progress;
const FORM = "progress-form";
const MAX_PHOTOS = 12;

type Props = { dealId: string; dealHref: string; device: Device };

/**
 * Отчёт о ходе работ: заголовок (по желанию), что сделано, фото (по желанию, с камеры на телефоне). «Отправить отчёт» —
 * одно главное действие в `ActionDock`; пока грузятся фото, отправка ждёт (тост). Двойное нажатие — одна отправка
 * (`useActionForm` гасит повтор, после успеха кнопка остаётся занятой до ухода). После — тост и карточка сделки.
 */
export function ProgressForm({ dealId, dealHref, device }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [done, setDone] = useState(false);
  const uploads = usePhotoUploads("PROGRESS_REPORT", [], t.photos.name);
  // Ключ повтора: обрыв связи после записи и повторная отправка того же отчёта не дадут второго; правка — новый отчёт.
  const retry = useClientKey();
  const form = useActionForm(progressReportAction, {
    toInput: () => {
      const report = { dealId, title, text, photoIds: uploads.fileIds };
      return { ...report, clientKey: retry.keyFor(report) };
    },
    onSuccess: () => {
      retry.done();
      setDone(true);
      toast(t.sent);
      router.push(dealHref);
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    if (done) return event.preventDefault();
    if (uploads.busy) {
      event.preventDefault();
      toast(t.photos.uploading);
      return;
    }
    form.onSubmit(event);
  }

  return (
    <>
      <Card>
        <form id={FORM} method="post" onSubmit={submit} noValidate>
          <Stack gap="section">
            <TextField
              label={t.titleLabel}
              name="title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={120}
              autoComplete="off"
              {...(form.fieldErrors.title ? { error: form.fieldErrors.title } : {})}
            />
            <TextArea
              label={t.textLabel}
              name="text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={2000}
              rows={4}
              {...(form.fieldErrors.text ? { error: form.fieldErrors.text } : {})}
            />
            <Stack>
              <p className="text-sub font-medium text-ink">{t.photosTitle}</p>
              <Uploader
                items={uploads.items}
                max={MAX_PHOTOS}
                accept={PHOTO_ACCEPT}
                capture="environment"
                label={t.photos.add}
                onAdd={uploads.add}
                onRemove={uploads.remove}
                onRetry={uploads.retry}
                onReject={(_files, why) => toast.error(why === "type" ? t.photos.rejectType : t.photos.rejectLimit(MAX_PHOTOS))}
              />
            </Stack>
            <FormError error={form.error} atField={Boolean(form.fieldErrors.text ?? form.fieldErrors.title)} />
          </Stack>
        </form>
      </Card>
      <LeaveGuard dirty={!done && (title.trim() !== "" || text.trim() !== "" || uploads.fileIds.length > 0)} device={device} />
      <ActionDock>
        <Button type="submit" form={FORM} pending={form.pending || done}>
          {t.submit}
        </Button>
      </ActionDock>
    </>
  );
}
