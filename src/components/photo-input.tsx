"use client";

import { Camera, X } from "lucide-react";
import { useRef } from "react";

const MAX_SIDE = 1100;

/** Сжимает фото на клиенте до JPEG ~150 КБ, чтобы в демо не нужно было файловое хранилище. */
export async function compressImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.72);
}

export function PhotoInput({
  photos,
  onChange,
  max = 4,
  suggestions = [],
}: {
  photos: string[];
  onChange: (photos: string[]) => void;
  max?: number;
  suggestions?: string[];
}) {
  const ref = useRef<HTMLInputElement>(null);
  const unused = suggestions.filter((s) => !photos.includes(s));

  async function onFiles(files: FileList | null) {
    if (!files) return;
    const added = await Promise.all(Array.from(files).slice(0, max - photos.length).map(compressImage));
    onChange([...photos, ...added]);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {photos.map((src, i) => (
          <div key={i} className="relative h-20 w-24 overflow-hidden rounded-lg border border-line">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt="" className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={() => onChange(photos.filter((_, j) => j !== i))}
              className="absolute top-1 right-1 rounded-full bg-black/60 p-0.5 text-white"
              aria-label="Удалить фото"
            >
              <X size={12} />
            </button>
          </div>
        ))}
        {photos.length < max && (
          <button
            type="button"
            onClick={() => ref.current?.click()}
            className="flex h-20 w-24 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-ink/25 text-xs text-muted hover:border-brand hover:text-brand"
          >
            <Camera size={18} />
            Фото
          </button>
        )}
        <input
          ref={ref}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            onFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {unused.length > 0 && photos.length < max && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span>или демо-фото:</span>
          {unused.map((src) => (
            <button
              key={src}
              type="button"
              onClick={() => onChange([...photos, src])}
              className="h-9 w-12 overflow-hidden rounded border border-line hover:border-brand"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
