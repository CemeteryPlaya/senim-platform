"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ImageOff, X } from "lucide-react";
import { ru } from "@/i18n/ru";
import type { PhotoView } from "@/modules/companies";
import { Alert, Button } from "@/ui";
import { removeWorkPhoto } from "../actions";

const t = ru.companies.portfolio.photos;

/** Фото работы: миниатюры с «Убрать» и место под загрузку. */
export function WorkPhotos({ itemId, photos }: { itemId: string; photos: PhotoView[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const remove = (fileId: string) => {
    setError(null);
    startTransition(async () => {
      const result = await removeWorkPhoto({ id: itemId, fileId });
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {photos.length > 0 && (
        <ul className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3 sm:grid-cols-[repeat(3,minmax(0,1fr))]">
          {photos.map((photo, i) => (
            <li key={photo.id} className="flex flex-col gap-2">
              {photo.src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photo.src} alt={photo.alt} className="aspect-[4/3] w-full rounded-control bg-sunken object-cover" />
              ) : (
                <div className="flex aspect-[4/3] w-full items-center justify-center rounded-control bg-sunken text-muted">
                  <ImageOff aria-hidden className="size-6" />
                  <span className="sr-only">{photo.alt}</span>
                </div>
              )}
              <Button variant="ghost" icon={<X />} disabled={pending} onClick={() => remove(photo.id)}>
                {t.remove(i + 1)}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {/*
        INTEGRATOR: сюда — компонент из src/app/_components/uploader (platform-engineer) с purpose PORTFOLIO;
        после загрузки вызвать attachWorkPhotos({ id: itemId, fileIds }) из ../actions и router.refresh().
      */}
      <p className="rounded-card border border-dashed border-line-strong p-4 text-base text-muted">{t.uploaderPending}</p>

      {error && (
        <Alert tone="danger" live="assertive">
          {error}
        </Alert>
      )}
    </div>
  );
}
