"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ru } from "@/i18n/ru";
import { Uploader, type UploaderItem } from "@/kit";

const t = ru.app.operatorQueues.money;

/** Что принимает поле: PDF, JPEG, PNG (политика BANK_DOCUMENT в files принимает фото или PDF). */
export const SCAN_ACCEPT = "application/pdf,image/jpeg,image/png";
/** Предел тела Server Action — 4 МБ (next.config): больший скан до сервера не дойдёт. */
export const SCAN_MAX_BYTES = 4 * 1024 * 1024;

/** Выбранный файл скана → причина отказа в браузере или `null` (тип отсекает сам `Uploader`). */
export function scanProblem(file: Pick<File, "size">): string | null {
  return file.size > SCAN_MAX_BYTES ? t.scanTooLarge : null;
}

type Props = {
  /** Выбранный скан или `null`. */
  file: File | null;
  onChange: (file: File | null) => void;
  /** Ошибка у поля: с сервера (`scan`, `bankDocFileId`) или своя (тип, размер). */
  error?: string;
};

/**
 * Скан документа банка: подпись, пояснение и `Uploader` kit на один файл. Файл не загружается заранее — он уходит в действие
 * подтверждения вместе с номером и датой (`toInput` формы), сервер сохраняет его после проверки кода. PDF — значок
 * документа с именем, фото — превью (blob:, освобождается при замене и уходе с экрана). Не тот тип или больше 4 МБ —
 * ошибка у поля сразу, файл не берётся.
 */
export function ScanField({ file, onChange, error }: Props) {
  const labelId = useId();
  const hintId = useId();
  const errorId = useId();
  const [own, setOwn] = useState<string | null>(null);
  // Превью фото создаётся при выборе (событие, не эффект) и освобождается при замене, удалении и уходе с экрана.
  const [preview, setPreview] = useState<string | null>(null);
  const previewRef = useRef<string | null>(null);
  const showPreview = (next: string | null) => {
    if (previewRef.current !== null) URL.revokeObjectURL(previewRef.current);
    previewRef.current = next;
    setPreview(next);
  };
  useEffect(
    () => () => {
      if (previewRef.current !== null) URL.revokeObjectURL(previewRef.current);
    },
    [],
  );

  const items: UploaderItem[] =
    file === null
      ? []
      : [{ id: "scan", name: file.name, kind: file.type === "application/pdf" ? "document" : "image", previewUrl: preview ?? undefined, state: "done" }];
  const shown = own ?? error;

  return (
    <div role="group" aria-labelledby={labelId} aria-describedby={shown ? `${hintId} ${errorId}` : hintId} className="flex flex-col gap-2">
      <p id={labelId} className="text-sub font-medium text-ink">
        {t.scan}
      </p>
      <p id={hintId} className="text-sub text-muted">
        {t.scanHint}
      </p>
      <Uploader
        name="scan"
        items={items}
        max={1}
        accept={SCAN_ACCEPT}
        label={t.scanPick}
        onAdd={([picked]) => {
          if (picked === undefined) return;
          const problem = scanProblem(picked);
          setOwn(problem);
          if (problem !== null) return;
          showPreview(picked.type === "application/pdf" ? null : URL.createObjectURL(picked));
          onChange(picked);
        }}
        onRemove={() => {
          setOwn(null);
          showPreview(null);
          onChange(null);
        }}
        onReject={(_files, reason) => setOwn(reason === "type" ? t.scanType : null)}
      />
      {shown && (
        <p id={errorId} role="alert" className="text-sub text-danger">
          {shown}
        </p>
      )}
    </div>
  );
}
