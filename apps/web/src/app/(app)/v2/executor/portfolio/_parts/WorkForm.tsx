"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { PHOTO_ACCEPT } from "@/features/upload/transfer";
import { ru } from "@/i18n/ru";
import { ActionDock, Button, Card, Checkbox, Explain, Notice, RadioCard, RadioGroup, Select, Stack, TextArea, TextField, toast, Uploader } from "@/kit";
import type { Device } from "@/platform/device";
import { FormError } from "../../../../_shell/FormError";
import { useActionForm } from "../../../../_shell/form";
import { to } from "../../../../_shell/paths";
import { usePhotoUploads, type SavedPhoto } from "../../../_upload/usePhotoUploads";
import { createWorkAction, updateWorkAction } from "../actions";
import { DESCRIPTION_MAX, PLACE_MAX, TITLE_MAX, type WorkInput } from "./work-schema";
import { STYLE_OPTIONS, toPrice, workHref, type WorkValues } from "./work-view";

const t = ru.app.masterPortfolio.form;
const FORM = "work-form";

type Props = {
  device: Device;
  types: readonly { id: string; name: string }[];
  /** Значения формы; у правки `published` берётся отсюда при каждой отправке (его меняет «Скрыть из каталога» отдельно). */
  initial: WorkValues;
  /** Есть — правка этой работы, нет — новая. */
  itemId?: string;
  photos: readonly SavedPhoto[];
  maxPhotos: number;
};

/** Ошибка раздела фото: тот же вид, что у полей kit. */
function SectionError({ children }: { children: string | undefined }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-sub text-danger">
      {children}
    </p>
  );
}

/**
 * Форма работы: фото, тип, стиль, название, описание, место, цена «от» и (у новой) «Показывать в каталоге». «Добавить
 * работу» / «Сохранить» — главное действие экрана (док на телефоне): пока фото грузятся, отправка ждёт; после успеха
 * новой работы кнопка занята до перехода — вторая работа не создаётся. Ошибки — у полей. О маске имени и контактов в
 * названии и описании — пояснение по нажатию, после сохранения — плашка и тексты так, как их записал сервер.
 */
export function WorkForm({ device, types, initial, itemId, photos, maxPhotos }: Props) {
  const router = useRouter();
  const uploads = usePhotoUploads("PORTFOLIO", photos, t.photoName);
  const [typeId, setTypeId] = useState(initial.furnitureTypeId);
  const [style, setStyle] = useState(initial.style);
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [place, setPlace] = useState(initial.place);
  const [price, setPrice] = useState(initial.price);
  const [published, setPublished] = useState(initial.published);
  const [masked, setMasked] = useState(false);
  const [done, setDone] = useState(false);

  const toInput = (): WorkInput => ({
    furnitureTypeId: typeId,
    // Пустой выбор отклоняет схема действия: ошибка у поля.
    style: style as Exclude<WorkValues["style"], "">,
    title,
    description,
    // Не число («abc») даёт NaN — схема отвечает ошибкой у поля.
    priceFrom: toPrice(price),
    published: itemId ? initial.published : published,
    place,
    fileIds: uploads.fileIds,
  });

  const create = useActionForm(createWorkAction, {
    toInput,
    onSuccess: (data) => {
      setDone(true);
      if (!data.photosAttached) {
        toast.error(t.photosFailed);
        router.replace(workHref(data.id));
        return;
      }
      toast(data.masked ? t.createdMasked : t.created);
      router.replace(to("/executor/portfolio"));
    },
  });
  const update = useActionForm(updateWorkAction, {
    toInput: () => ({ id: itemId ?? "", ...toInput() }),
    onSuccess: (data) => {
      setTitle(data.title);
      setDescription(data.description);
      setMasked(data.masked);
      toast(t.saved);
      router.refresh();
    },
  });
  const form = itemId ? update : create;
  const err = form.fieldErrors;
  const atField = Object.keys(err).length > 0;
  const root = useRef<HTMLFormElement>(null);
  const photoSection = useRef<HTMLDivElement>(null);

  // Ответ сервера с ошибками у полей — фокус на первую: ошибка фото — на раздел фото, иначе на первое поле с ошибкой.
  useEffect(() => {
    if (!atField) return;
    if (err.fileIds) photoSection.current?.focus();
    else root.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [atField, err]);

  function submit(event: FormEvent<HTMLFormElement>) {
    if (uploads.busy) {
      event.preventDefault();
      toast(t.uploading);
      return;
    }
    if (done) {
      event.preventDefault();
      return;
    }
    form.onSubmit(event);
  }

  return (
    <>
      <Card>
        <form ref={root} id={FORM} method="post" onSubmit={submit} noValidate>
          <Stack gap="section">
            <div ref={photoSection} tabIndex={-1} className="flex flex-col gap-stack-group outline-none">
              <p className="text-sub font-medium text-ink">{t.photosTitle}</p>
              <Uploader
                items={uploads.items}
                max={maxPhotos}
                accept={PHOTO_ACCEPT}
                capture="environment"
                label={t.photosAdd}
                onAdd={uploads.add}
                onRemove={uploads.remove}
                onRetry={uploads.retry}
                onReject={(_files, reason) => toast.error(reason === "type" ? t.rejectType : t.rejectLimit(maxPhotos))}
              />
              <p className="text-sub text-muted">{t.photosHint(maxPhotos)}</p>
              <SectionError>{err.fileIds}</SectionError>
            </div>

            <Select label={t.type} name="furnitureTypeId" value={typeId} onChange={(e) => setTypeId(e.target.value)} {...(err.furnitureTypeId ? { error: err.furnitureTypeId } : {})}>
              <option value="">{t.typePlaceholder}</option>
              {types.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </Select>

            <RadioGroup legend={t.style} {...(err.style ? { error: err.style } : {})}>
              {STYLE_OPTIONS.map((option) => (
                <RadioCard
                  key={option.value}
                  name="style"
                  value={option.value}
                  label={option.label}
                  description={option.description}
                  checked={style === option.value}
                  onChange={() => setStyle(option.value)}
                />
              ))}
            </RadioGroup>

            <Stack>
              <TextField label={t.title} name="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={TITLE_MAX} autoComplete="off" error={err.title} />
              <TextArea label={t.description} name="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={5} maxLength={DESCRIPTION_MAX} error={err.description} />
              <div>
                <Explain label={t.explainMask.label} title={t.explainMask.title} device={device}>
                  {t.explainMask.points.map((point) => (
                    <p key={point} className="mb-2 last:mb-0">
                      {point}
                    </p>
                  ))}
                </Explain>
              </div>
              {masked && <Notice tone="info">{t.masked}</Notice>}
            </Stack>

            <TextField label={`${t.place} (${t.optional})`} name="place" value={place} onChange={(e) => setPlace(e.target.value)} maxLength={PLACE_MAX} autoComplete="off" error={err.place} />
            <TextField label={`${t.price} (${t.optional})`} name="priceFrom" value={price} onChange={(e) => setPrice(e.target.value)} inputMode="numeric" autoComplete="off" error={err.priceFrom} />
            {!itemId && <Checkbox name="published" label={t.published} checked={published} onChange={(e) => setPublished(e.target.checked)} />}
            <FormError error={form.error} atField={atField} />
          </Stack>
        </form>
      </Card>
      <ActionDock>
        <Button type="submit" form={FORM} disabled={done} pending={form.pending}>
          {itemId ? t.save : t.create}
        </Button>
      </ActionDock>
    </>
  );
}
