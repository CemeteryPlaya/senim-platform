"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { leaveIfSignedOut } from "@/modules/identity/client";
import { ru } from "@/i18n/ru";
import type { PhotoView } from "@/modules/companies";
import { Alert } from "@/ui";
import { Uploader } from "@/app/_components/uploader";
import { attachWorkPhotos, removeWorkPhoto } from "../actions";

const t = ru.companies.portfolio.photos;

/**
 * Фото работы: загрузчик показывает сохранённые фото; новое фото сразу прикрепляется к работе,
 * убранное — открепляется. Порядок сохранения — порядок загрузки.
 */
export function WorkPhotos({ itemId, photos, max }: { itemId: string; photos: PhotoView[]; max: number }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const saved = useRef(new Set(photos.map((p) => p.id)));
  const queue = useRef<Promise<void>>(Promise.resolve());

  async function sync(ids: string[]) {
    const added = ids.filter((id) => !saved.current.has(id));
    const removed = [...saved.current].filter((id) => !ids.includes(id));
    for (const fileId of removed) {
      const result = await removeWorkPhoto({ id: itemId, fileId });
      if (!result.ok) return void (leaveIfSignedOut(result) || setError(result.error));
      saved.current.delete(fileId);
    }
    if (added.length > 0) {
      const result = await attachWorkPhotos({ id: itemId, fileIds: added });
      if (!result.ok) return void (leaveIfSignedOut(result) || setError(result.error));
      added.forEach((id) => saved.current.add(id));
    }
    setError(null);
    router.refresh();
  }

  // Изменения применяются по очереди: два быстрых изменения не прикрепят один файл дважды.
  const onChange = (ids: string[]) => {
    queue.current = queue.current.then(() => sync(ids));
  };

  return (
    <div className="flex flex-col gap-4">
      <Uploader
        purpose="PORTFOLIO"
        label={t.title}
        hint={t.hint(max)}
        max={max}
        initial={photos.flatMap((p) => (p.src ? [{ id: p.id, url: p.src }] : []))}
        onChange={onChange}
      />
      {error && (
        <Alert tone="danger" live="assertive">
          {error}
        </Alert>
      )}
    </div>
  );
}
