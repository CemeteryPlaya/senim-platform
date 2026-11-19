"use client";

import { ru } from "@/i18n/ru";
import { Checkbox, HiddenField, Section, TextArea, toast, Uploader } from "@/kit";
import { LIMITS } from "@/modules/requests/client";
import { PHOTO_ACCEPT } from "@/features/upload/transfer";
import { usePhotoUploads, type SavedPhoto } from "../../_upload/usePhotoUploads";
import { designItems, type SavedDesign } from "./steps";
import { WizardFrame, useWizardStep, type WizardBase } from "./WizardFrame";

const t = ru.app.requests.wizard.room;
const d = t.design;

/** Файлы своего дизайн-проекта: фото или PDF. */
const DESIGN_ACCEPT = `${PHOTO_ACCEPT},application/pdf,.pdf`;

type Props = {
  base: WizardBase;
  photos: readonly SavedPhoto[];
  description: string;
  /** Сохранённые файлы своего дизайн-проекта (`getDraft().design`). */
  design: readonly (SavedPhoto & SavedDesign)[];
  /** Отметка «убрал из файлов контакты» уже стоит. */
  designConfirmed: boolean;
};

/**
 * Шаг 3 «Фото и описание» (можно пропустить): фото места — загрузчик kit и прямая загрузка в хранилище (назначение
 * REQUEST_ROOM, HEIC и пределы — как в v1, проверяет модуль files), описание своими словами и блок «Свой дизайн-проект»
 * (REQUEST_DESIGN: фото или PDF, до 5 файлов; при файлах — обязательная отметка о контактах, её проверяет и сервер). Пока
 * файлы загружаются, «Дальше» и «Назад» ждут; «Назад» сохраняет шаг; отклонённые файлы — тостом с причиной. К черновику
 * прикрепляются ровно выбранные файлы (модуль requests): пустой блок проекта уходит пустым списком — проект убирается.
 */
export function WizardRoom({ base, photos, description, design, designConfirmed }: Props) {
  const uploads = usePhotoUploads("REQUEST_ROOM", photos, ru.requests.wizard.room.photoAlt);
  const project = usePhotoUploads("REQUEST_DESIGN", design, d.photo);
  const busy = uploads.busy || project.busy;
  // «Назад» тоже сохраняет шаг: загруженные файлы и описание не теряются (пока файлы грузятся — ждёт, объясняя тостом).
  const form = useWizardStep("room", base, { blocked: { when: busy, onBlocked: () => toast(t.uploading) }, saveOnBack: true });
  return (
    <WizardFrame base={base} title={t.title} lead={t.lead} form={form} busy={busy}>
      <Uploader
        items={uploads.items}
        max={LIMITS.photos}
        accept={PHOTO_ACCEPT}
        capture="environment"
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
      <Section title={d.title}>
        <p className="text-body text-muted">{d.hint}</p>
        <Uploader
          items={designItems(project.items, design)}
          max={LIMITS.designFiles}
          accept={DESIGN_ACCEPT}
          label={d.add}
          onAdd={project.add}
          onRemove={project.remove}
          onRetry={project.retry}
          onReject={(_files, reason) => toast.error(reason === "type" ? d.rejectType : d.rejectLimit(LIMITS.designFiles))}
        />
        {project.fileIds.map((id) => (
          <HiddenField key={id} name="designFileIds" value={id} />
        ))}
        {project.items.length > 0 && (
          <Checkbox name="designContactsConfirmed" value="on" label={d.confirm} defaultChecked={designConfirmed} error={form.errors.designContactsConfirmed} />
        )}
      </Section>
    </WizardFrame>
  );
}
