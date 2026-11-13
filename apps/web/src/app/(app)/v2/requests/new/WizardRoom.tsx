"use client";

import { ru } from "@/i18n/ru";
import { HiddenField, TextArea, toast, Uploader } from "@/kit";
import { LIMITS } from "@/modules/requests/client";
import { PHOTO_ACCEPT } from "@/features/upload/transfer";
import { usePhotoUploads, type SavedPhoto } from "../../_upload/usePhotoUploads";
import { WizardFrame, useWizardStep, type WizardBase } from "./WizardFrame";

const t = ru.app.requests.wizard.room;

type Props = { base: WizardBase; photos: readonly SavedPhoto[]; description: string };

/**
 * Шаг 3 «Фото и описание» (можно пропустить): фото места — загрузчик kit и прямая загрузка в хранилище (назначение
 * REQUEST_ROOM, HEIC и пределы — как в v1, проверяет модуль files), описание своими словами. Пока фото загружаются,
 * «Дальше» и «Назад» ждут; «Назад» сохраняет шаг; отклонённые файлы — тостом с причиной. К черновику прикрепляются ровно выбранные фото (модуль requests).
 */
export function WizardRoom({ base, photos, description }: Props) {
  const uploads = usePhotoUploads("REQUEST_ROOM", photos, ru.requests.wizard.room.photoAlt);
  // «Назад» тоже сохраняет шаг: загруженные фото и описание не теряются (пока фото грузятся — ждёт, объясняя тостом).
  const form = useWizardStep("room", base, { blocked: { when: uploads.busy, onBlocked: () => toast(t.uploading) }, saveOnBack: true });
  return (
    <WizardFrame base={base} title={t.title} lead={t.lead} form={form} busy={uploads.busy}>
      <Uploader
        items={uploads.items}
        max={LIMITS.photos}
        accept={PHOTO_ACCEPT}
        label={t.addPhoto}
        onAdd={uploads.add}
        onRemove={uploads.remove}
        onRetry={uploads.retry}
        onReject={(_files, reason) => toast.error(reason === "type" ? t.rejectType : t.rejectLimit(LIMITS.photos))}
      />
      {uploads.fileIds.map((id) => (
        <HiddenField key={id} name="photoFileIds" value={id} />
      ))}
      <TextArea label={t.description} name="description" maxLength={LIMITS.description} defaultValue={description} error={form.errors.description} />
    </WizardFrame>
  );
}
