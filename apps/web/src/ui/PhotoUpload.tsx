"use client";

import { Camera, ImagePlus, RotateCw, X } from "lucide-react";
import { useId, useRef, type ChangeEvent, type ReactNode } from "react";
import { ru } from "@/i18n/ru";
import { cn } from "./cn";

export type PhotoItem = {
  id: string;
  /** Адрес превью: blob:/data: до загрузки или URL файла после. */
  src: string;
  alt?: string;
  status: "uploading" | "done" | "error";
  /** 0–100, пока status = "uploading". */
  progress?: number;
  /** Текст ошибки, если status = "error". */
  error?: string;
};

export type PhotoUploadProps = {
  label: ReactNode;
  hint?: ReactNode;
  /** Ошибка всего поля (например, «Добавьте хотя бы одно фото»). */
  error?: ReactNode;
  photos: readonly PhotoItem[];
  /** Пользователь выбрал или снял фото. Загрузку и сжатие делает вызывающий. */
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
  /** Повторить загрузку фото с ошибкой. Без обработчика кнопки повтора нет. */
  onRetry?: (id: string) => void;
  max?: number;
  accept?: string;
  disabled?: boolean;
  /** Пояснение под «Сфотографировать», например «Сделайте фото стен, пола и окон». */
  cameraHint?: ReactNode;
  /** Пояснение под «Загрузить фото». */
  chooseHint?: ReactNode;
};

type SourceButtonProps = { icon: ReactNode; title: ReactNode; text: ReactNode; disabled: boolean; onClick: () => void };

/** Крупная плитка источника фото: иконка в мятном круге, заголовок, пояснение (как в макете). */
function SourceButton({ icon, title, text, disabled, onClick }: SourceButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex min-h-control flex-col items-start gap-3 rounded-card border border-line bg-surface p-5 text-left",
        "transition-colors duration-150 hover:border-primary disabled:cursor-not-allowed disabled:opacity-60",
      )}
    >
      <span aria-hidden className="inline-flex size-12 items-center justify-center rounded-full bg-accent-soft text-primary [&_svg]:size-6">
        {icon}
      </span>
      <span className="text-lg font-bold text-ink">{title}</span>
      <span className="text-sm text-muted">{text}</span>
    </button>
  );
}

/** Выбор и съёмка фото, превью, прогресс, удаление. Только интерфейс: файлы отдаются в onAdd. */
export function PhotoUpload({ label, hint, error, photos, onAdd, onRemove, onRetry, max = 10, accept = "image/*", disabled = false, cameraHint, chooseHint }: PhotoUploadProps) {
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const countId = `${id}-count`;
  const left = max - photos.length;
  const full = left <= 0;
  const describedBy = [hint && hintId, error && errorId, countId].filter(Boolean).join(" ");

  const handleFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).slice(0, Math.max(left, 0));
    event.target.value = ""; // тот же файл можно выбрать снова
    if (files.length > 0) onAdd(files);
  };

  return (
    <div role="group" aria-labelledby={`${id}-label`} aria-describedby={describedBy} data-invalid={error ? "" : undefined} className="flex flex-col gap-3">
      <p id={`${id}-label`} className="text-base font-semibold text-ink">
        {label}
      </p>
      {hint && (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      )}

      {photos.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((photo, i) => (
            <PhotoTile key={photo.id} photo={photo} n={i + 1} onRemove={onRemove} onRetry={onRetry} disabled={disabled} />
          ))}
        </ul>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
        <SourceButton
          icon={<Camera />}
          title={ru.common.ui.photo.camera}
          text={cameraHint ?? ru.common.ui.photo.cameraHint}
          disabled={disabled || full}
          onClick={() => cameraRef.current?.click()}
        />
        <SourceButton
          icon={<ImagePlus />}
          title={ru.common.ui.photo.choose}
          text={chooseHint ?? ru.common.ui.photo.chooseHint}
          disabled={disabled || full}
          onClick={() => galleryRef.current?.click()}
        />
      </div>
      <input ref={galleryRef} type="file" accept={accept} multiple hidden tabIndex={-1} onChange={handleFiles} />
      <input ref={cameraRef} type="file" accept={accept} capture="environment" hidden tabIndex={-1} onChange={handleFiles} />

      <p id={countId} className="text-sm text-muted" aria-live="polite">
        {full ? ru.common.ui.photo.limit : ru.common.ui.photo.count(photos.length, max)}
      </p>
      {error && (
        <p id={errorId} className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

type TileProps = {
  photo: PhotoItem;
  n: number;
  onRemove: (id: string) => void;
  onRetry?: (id: string) => void;
  disabled: boolean;
};

function PhotoTile({ photo, n, onRemove, onRetry, disabled }: TileProps) {
  const t = ru.common.ui.photo;
  const progress = Math.round(photo.progress ?? 0);
  return (
    <li className="flex min-w-0 flex-col gap-2">
      <div className="relative aspect-square overflow-hidden rounded-card border border-line bg-sunken">
        {/* Превью локального blob:/data: — оптимизация next/image здесь не нужна. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photo.src}
          alt={photo.alt ?? t.preview(n)}
          className={cn("size-full object-cover", photo.status !== "done" && "opacity-60")}
        />
        <button
          type="button"
          onClick={() => onRemove(photo.id)}
          disabled={disabled}
          aria-label={t.remove(n)}
          className="absolute top-1 right-1 inline-flex size-12 cursor-pointer items-center justify-center rounded-control bg-surface text-ink hover:bg-sunken disabled:cursor-not-allowed"
        >
          <X aria-hidden className="size-6" />
        </button>
        {photo.status === "uploading" && (
          <div className="absolute inset-x-0 bottom-0 bg-surface px-2 py-1.5">
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              aria-label={t.preview(n)}
              className="h-1.5 overflow-hidden rounded-full bg-line"
            >
              <div className="h-full origin-left bg-accent transition-transform duration-150" style={{ transform: `scaleX(${progress / 100})` }} />
            </div>
          </div>
        )}
      </div>
      {photo.status === "uploading" && <p className="text-sm text-muted">{t.uploading(progress)}</p>}
      {/* Область объявлений есть всегда (пустая не видна): появившаяся в ней ошибка будет прочитана — «Фото 2: Не загрузилось». */}
      <p aria-live="polite" className="sr-only">
        {photo.status === "error" && `${t.preview(n)}: ${photo.error ?? t.failed}`}
      </p>
      {photo.status === "error" && (
        <div className="flex flex-col gap-1">
          {/* Для диктора тот же текст уже есть в области объявлений выше. */}
          <p aria-hidden className="text-sm font-semibold text-danger">
            {photo.error ?? t.failed}
          </p>
          {onRetry && (
            <button
              type="button"
              onClick={() => onRetry(photo.id)}
              disabled={disabled}
              aria-label={t.retry(n)}
              className="inline-flex min-h-control-sm cursor-pointer items-center gap-2 self-start text-base font-semibold text-ink underline decoration-line-strong underline-offset-4 hover:decoration-accent"
            >
              <RotateCw aria-hidden className="size-5 shrink-0" />
              {ru.common.actions.retry}
            </button>
          )}
        </div>
      )}
    </li>
  );
}
