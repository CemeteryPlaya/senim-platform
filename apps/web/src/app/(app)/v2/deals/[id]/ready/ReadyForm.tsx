"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { GeoFix } from "@/features/delivery/request-location";
import { PHOTO_ACCEPT } from "@/features/upload/transfer";
import { ru } from "@/i18n/ru";
import { ActionDock, Button, Card, Explain, Section, Stack, toast, Uploader } from "@/kit";
import type { Device } from "@/platform/device";
import { FormError } from "../../../../_shell/FormError";
import { useActionForm } from "../../../../_shell/form";
import { useGeolocation } from "../../../../_shell/useGeolocation";
import { usePhotoUploads } from "../../../_upload/usePhotoUploads";
import { submitReadyAction, type ReadyOutcome } from "./actions";
import { doneToast, MAX_PHOTOS, placeView, readyInput } from "./_parts/ready-view";

const t = ru.app.masterSteps.ready;
const FORM = "ready-form";

type Props = { dealId: string; dealHref: string; device: Device };

/**
 * Сдача работы: фото готовой мебели (обязательно, до 12, на телефоне — с камеры), место сдачи по нажатию «Отметить место
 * сдачи» (все состояния честные: не отмечено, определяем, отмечено, отказ, таймаут, не определилось, недоступно) и
 * пояснение «Зачем геолокация?». «Сдать работу» — одно главное действие: без фото — ошибка у фото; место ещё определяется —
 * сдача дожидается ответа; без места сдача идёт тоже (проверку расстояния решает модуль). Двойное нажатие — одна отправка,
 * модуль даёт один переход. После — тост (сдано далеко — с расстоянием) и карточка сделки.
 */
export function ReadyForm({ dealId, dealHref, device }: Props) {
  const router = useRouter();
  const geo = useGeolocation();
  const place = placeView(geo.state);
  const uploads = usePhotoUploads("DELIVERY", [], t.photos.name);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [waiting, setWaiting] = useState(false);
  // Место, с которым уходит сдача: ответ геолокации, дождавшийся перед отправкой (состояние хука обновится позже).
  const fix = useRef<GeoFix | null>(null);
  const form = useActionForm(submitReadyAction, {
    toInput: () => readyInput(dealId, uploads.fileIds, fix.current ? { status: "located", fix: fix.current } : geo.state),
    onSuccess: (result: ReadyOutcome) => {
      setDone(true);
      // Сдано далеко — тост называет расстояние (предупреждение, не запрет: так решил модуль).
      toast(doneToast(result).text);
      router.push(dealHref);
    },
  });
  const photosError = photoError ?? form.fieldErrors.photoIds ?? null;
  // Ошибка «нет фото» — фокус на раздел фото: диктор читает ошибку, на телефоне раздел прокручивается в вид.
  const photos = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (photosError) photos.current?.focus();
  }, [photosError]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (done || waiting || form.pending) return;
    if (uploads.busy) {
      toast(t.photos.uploading);
      return;
    }
    if (uploads.fileIds.length === 0) {
      setPhotoError(t.errors.photos);
      // Повторное нажатие с той же ошибкой — фокус снова на фото (эффект ниже срабатывает только на смену текста).
      photos.current?.focus();
      return;
    }
    setPhotoError(null);
    fix.current = null;
    if (geo.state.status === "locating") {
      // Место ещё определяется: дождаться ответа (успех или отказ) — сдача уйдёт с ним или без места.
      setWaiting(true);
      fix.current = await geo.request();
      setWaiting(false);
    }
    await form.submit(new FormData());
  }

  return (
    <>
      <Section title={t.photosTitle}>
        <Card>
          <form id={FORM} method="post" onSubmit={(event) => void submit(event)} noValidate>
            <div ref={photos} tabIndex={-1} className="flex flex-col gap-3 outline-none">
              <p className="text-sub text-muted">{t.photosLead}</p>
              <Uploader
                items={uploads.items}
                max={MAX_PHOTOS}
                accept={PHOTO_ACCEPT}
                capture="environment"
                label={t.photos.add}
                onAdd={(files) => {
                  setPhotoError(null);
                  uploads.add(files);
                }}
                onRemove={uploads.remove}
                onRetry={uploads.retry}
                onReject={(_files, why) => toast.error(why === "type" ? t.photos.rejectType : t.photos.rejectLimit(MAX_PHOTOS))}
              />
              {photosError && (
                <p role="alert" className="text-sub text-danger">
                  {photosError}
                </p>
              )}
              <FormError error={form.error} atField={Boolean(form.fieldErrors.photoIds)} />
            </div>
          </form>
        </Card>
      </Section>
      <Section title={t.place.section}>
        <Card>
          <Stack>
            <p role="status" className={place.kind === "located" ? "text-headline text-ink" : "text-body text-ink"}>
              {place.text}
            </p>
            {place.button && (
              <div>
                <Button variant="secondary" pending={place.kind === "locating"} onClick={() => void geo.request()}>
                  {place.button}
                </Button>
              </div>
            )}
          </Stack>
        </Card>
        <div>
          <Explain label={t.place.explain.label} title={t.place.explain.title} device={device}>
            {t.place.explain.points.map((point) => (
              <p key={point} className="mb-2 last:mb-0">
                {point}
              </p>
            ))}
          </Explain>
        </div>
      </Section>
      <ActionDock>
        <Button type="submit" form={FORM} pending={form.pending || waiting || done}>
          {t.submit}
        </Button>
      </ActionDock>
    </>
  );
}
