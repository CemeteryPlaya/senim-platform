"use client";

import { Camera, FileText, ImagePlus, RotateCw, X } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import { ru } from "@/i18n/ru";
import { Button } from "./Button";
import { cn } from "./cn";
import { progressPercent, sortFiles } from "./uploader-logic";

export type UploaderItem = {
  id: string;
  name: string;
  /** Адрес превью (blob: или из хранилища); без него — ровная заглушка. */
  previewUrl?: string;
  /** `"document"` — не фото (PDF): вместо превью значок документа с именем файла. По умолчанию фото. */
  kind?: "image" | "document";
  state: "uploading" | "done" | "error";
  /** Ход загрузки, проценты 0–100; без него у загружающегося файла — пульсация. */
  progress?: number;
  /** Текст ошибки этого файла (из `ru`). */
  error?: string;
};

export type UploaderProps = {
  items: readonly UploaderItem[];
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
  /** Повторить загрузку файла с ошибкой; без него кнопки «Повторить» нет. */
  onRetry?: (id: string) => void;
  /**
   * Файлы не приняты: `"type"` — не подходят под `accept`, `"limit"` — сверх предела `max`. Без обработчика отбрасываются
   * молча; покажите причину (тостом или строкой).
   */
  onReject?: (files: File[], reason: "type" | "limit") => void;
  /** Предел числа фото. */
  max: number;
  /** Что принимает выбор файлов (как `accept` у input); по умолчанию любые изображения. Для PDF — `"image/*,application/pdf"`. */
  accept?: string;
  /**
   * Кнопка «Снять на камеру» (только на телефоне): открывает камеру устройства, `"environment"` — основную, `"user"` —
   * фронтальную. Камера отдаёт только изображения (`image/*`): если в `accept` изображений нет, снимок будет отклонён как неверный тип. Без пропа кнопки нет.
   */
  capture?: "environment" | "user";
  /** Подпись кнопки добавления; по умолчанию «Добавить фото». */
  label?: string;
  /** Имя поля формы для скрытого input; обычно не требуется (файлы уходят через `onAdd`). */
  name?: string;
};

/** Превью: заглушка `line` и фото поверх; адрес из хранилища или blob:, оптимизатор изображений не нужен. */
function Preview({ item, className, showName = true }: { item: UploaderItem; className: string; showName?: boolean }) {
  if (item.kind === "document") {
    return (
      <div className={cn("flex flex-col items-center justify-center gap-1 overflow-hidden rounded-field bg-line p-2 text-muted", className)}>
        <FileText aria-hidden className="size-6 shrink-0" />
        {/* Длинное имя без пробелов не рвём посреди слова: одна строка с многоточием; полное имя — в title и в тексте для диктора. */}
        {showName && (
          <span title={item.name} className="block w-full min-w-0 truncate text-center text-small text-ink">
            {item.name}
          </span>
        )}
      </div>
    );
  }
  return (
    <div className={cn("relative overflow-hidden rounded-field bg-line", className)}>
      {item.previewUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.previewUrl} alt={item.name} loading="lazy" decoding="async" className="size-full object-cover" />
      )}
    </div>
  );
}

/**
 * Выбор и показ фото: кнопка добавления (внутри скрытый `input type="file"`), сетка превью с ходом загрузки, ошибка и
 * «Повторить» / «Убрать» у файла, счётчик «N из max». Компонент «глупый»: состояние загрузки, отправка и повторы — у
 * вызывающего (автомат `src/features/upload`), сюда приходят готовые `items`. На компьютере файлы можно перетащить на
 * область (необязательное улучшение). Клиентский компонент.
 */
export function Uploader({ items, onAdd, onRemove, onRetry, onReject, max, accept = "image/*", capture, label, name }: UploaderProps) {
  const t = ru.app.kit.uploader;
  const input = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const full = items.length >= max;

  const add = (files: readonly File[]) => {
    const { accepted, wrongType, overLimit } = sortFiles(files, items.length, max, accept);
    if (accepted.length > 0) onAdd(accepted);
    if (wrongType.length > 0) onReject?.(wrongType, "type");
    if (overLimit.length > 0) onReject?.(overLimit, "limit");
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    add(Array.from(event.dataTransfer.files));
  };

  return (
    <div
      className={cn("flex flex-col gap-3 rounded-card", dragging && "bg-accent-soft")}
      onDragOver={(event) => {
        if (full) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {items.length > 0 && (
        <ul className="grid grid-cols-3 gap-3 desktop:grid-cols-4">
          {items.map((item) => {
            if (item.state === "error") {
              // Ошибка — строка во всю ширину: узкой плитке не вместить текст и две кнопки.
              return (
                <li key={item.id} className="col-span-full flex flex-col gap-3 rounded-field bg-danger-soft p-3">
                  <div className="flex items-center gap-3">
                    <Preview item={item} className="size-16 shrink-0" showName={false} />
                    <div className="flex min-w-0 flex-col gap-1">
                      <p className="text-sub font-medium wrap-break-word text-ink">{item.name}</p>
                      <p role="alert" className="text-sub text-danger">
                        {item.error}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {onRetry && (
                      <Button variant="secondary" size="sm" aria-label={t.retryNamed(item.name)} onClick={() => onRetry(item.id)}>
                        <span className="inline-flex items-center gap-2">
                          <RotateCw aria-hidden className="size-4" />
                          {t.retry}
                        </span>
                      </Button>
                    )}
                    <Button variant="quiet" size="sm" aria-label={t.removeNamed(item.name)} onClick={() => onRemove(item.id)}>
                      {t.remove}
                    </Button>
                  </div>
                </li>
              );
            }
            const percent = item.state === "uploading" ? progressPercent(item.progress) : null;
            return (
              <li key={item.id} className="relative">
                <Preview item={item} className="aspect-square w-full" />
                {item.state === "uploading" && (
                  <div
                    role="progressbar"
                    aria-label={item.name}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent ?? undefined}
                    aria-valuetext={percent === null ? t.uploading : t.uploadingPercent(percent)}
                    className="absolute inset-x-2 bottom-2 h-progress overflow-hidden rounded-full bg-line"
                  >
                    {percent === null ? (
                      <div className="h-full w-full animate-pulse bg-accent" />
                    ) : (
                      <div className="h-full w-full origin-left bg-accent" style={{ transform: `scaleX(${percent / 100})` }} />
                    )}
                  </div>
                )}
                {item.state === "done" && <span className="sr-only">{t.done}</span>}
                {/* Знак 20 px на подложке 32 px; область касания расширена псевдоэлементом до 48 px. */}
                <button
                  type="button"
                  aria-label={t.removeNamed(item.name)}
                  onClick={() => onRemove(item.id)}
                  className="absolute top-2 right-2 flex size-8 items-center justify-center rounded-full bg-raised text-ink shadow-float before:absolute before:-inset-2"
                >
                  <X aria-hidden className="size-5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="secondary" disabled={full} onClick={() => input.current?.click()}>
          <span className="inline-flex items-center gap-2">
            <ImagePlus aria-hidden className="size-5" />
            {label ?? t.add}
          </span>
        </Button>
        {capture && (
          <Button variant="secondary" disabled={full} onClick={() => camera.current?.click()} className="desktop:hidden">
            <span className="inline-flex items-center gap-2">
              <Camera aria-hidden className="size-5" />
              {t.camera}
            </span>
          </Button>
        )}
        <p role="status" className="text-sub text-muted">
          {t.counter(items.length, max)}
        </p>
      </div>
      {!full && <p className="text-sub text-muted mobile:hidden">{t.drop}</p>}
      <input
        ref={input}
        type="file"
        name={name}
        accept={accept}
        multiple={max - items.length > 1}
        hidden
        tabIndex={-1}
        onChange={(event) => {
          add(Array.from(event.target.files ?? []));
          // Сброс значения: тот же файл можно выбрать снова (после «Убрать»).
          event.target.value = "";
        }}
      />
      {capture && (
        <input
          ref={camera}
          type="file"
          accept="image/*"
          capture={capture}
          hidden
          tabIndex={-1}
          onChange={(event) => {
            add(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
      )}
    </div>
  );
}
