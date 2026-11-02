"use client";

import { useState } from "react";
import { Uploader } from "@/app/_components/uploader";
import { ru } from "@/i18n/ru";
import { Button, ConfirmButton, FormError, Input, Textarea } from "@/ui";
import { useRunAction } from "../../_parts/useRunAction";
import { payAction, progressReportAction, submitReadyAction } from "../actions";
import { currentPosition } from "./geolocation";
import { focusNextStep } from "./next-step";
import { DELIVERY_PURPOSE, PROGRESS_PURPOSE } from "./upload-purpose";

const t = ru.deal;

/**
 * «Оплатить N ₸» (ТЗ п. 4.1): mock подтверждает сразу — экран покажет «под защитой банка»; manual — «Оплата в
 * обработке» до подтверждения оператором; провайдер со своей страницей (Freedom Pay) — переход на неё.
 * Двойной клик — одна операция (кнопка заблокирована на время запроса, сервер повтор не создаёт).
 */
export function PayButton({ dealId, amount }: { dealId: string; amount: string }) {
  const { run, pending, error } = useRunAction(payAction);
  const [redirecting, setRedirecting] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <ConfirmButton
        fullWidth
        pending={pending || redirecting}
        error={error}
        onRun={() =>
          run({ dealId }, (data) => {
            if (data.redirectUrl) {
              setRedirecting(true);
              window.location.assign(data.redirectUrl);
            } else focusNextStep();
          })
        }
      >
        {t.actions.pay(amount)}
      </ConfirmButton>
      <p className="text-base text-ink-soft" aria-live="polite">
        {redirecting ? t.pay.redirecting : ""}
      </p>
    </div>
  );
}

/**
 * Мастер сдаёт работу: фото результата обязательно (загрузчик files, назначение DELIVERY); при отправке —
 * геолокация браузера. Нет ответа или отказ — сдаём без координат; дальше радиуса — предупреждение после сдачи.
 */
export function ReadyForm({ dealId }: { dealId: string }) {
  const { run, pending, error, fieldErrors } = useRunAction(submitReadyAction);
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  // Пока фото загружается, его id ещё нет в photoIds: отправка дала бы «Добавьте хотя бы одно фото».
  const [uploading, setUploading] = useState(false);
  const [locating, setLocating] = useState(false);
  const busy = uploading || locating;

  async function submit() {
    setLocating(true);
    const point = await currentPosition();
    setLocating(false);
    run({ dealId, photoIds, ...(point ?? {}) }, focusNextStep);
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy && !pending) void submit();
      }}
    >
      <Uploader
        purpose={DELIVERY_PURPOSE}
        label={t.ready.photosLabel}
        hint={t.ready.photosHint}
        max={12}
        onChange={setPhotoIds}
        onBusyChange={setUploading}
        error={fieldErrors.photoIds?.[0]}
      />
      <FormError message={error} />
      <Button type="submit" fullWidth loading={pending || busy} aria-describedby="ready-wait">
        {t.actions.submitReady}
      </Button>
      <p id="ready-wait" className="text-base text-ink-soft" aria-live="polite">
        {uploading ? t.ready.waitPhotos : locating ? t.ready.locating : ""}
      </p>
    </form>
  );
}

/** «Ход работ»: необязательный фото-отчёт мастера, без денег и актов. */
export function ProgressForm({ dealId }: { dealId: string }) {
  const { run, pending, error, fieldErrors } = useRunAction(progressReportAction);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  // Новая форма после отправки: ключ сбрасывает загрузчик вместе с полями.
  const [round, setRound] = useState(0);

  return (
    <form
      key={round}
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!uploading)
          run({ dealId, title, text, photoIds }, () => {
            setTitle("");
            setText("");
            setPhotoIds([]);
            setRound((n) => n + 1);
          });
      }}
    >
      <Input label={t.progress.titleLabel} optional name="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} error={fieldErrors.title?.[0]} />
      <Textarea label={t.progress.textLabel} name="text" value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={3} error={fieldErrors.text?.[0]} />
      <Uploader purpose={PROGRESS_PURPOSE} label={t.progress.photosLabel} max={12} onChange={setPhotoIds} onBusyChange={setUploading} error={fieldErrors.photoIds?.[0]} />
      <FormError message={error} />
      <Button type="submit" variant="secondary" fullWidth loading={pending || uploading}>
        {t.actions.sendProgress}
      </Button>
    </form>
  );
}
