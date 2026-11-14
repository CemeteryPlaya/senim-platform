"use client";

import { useEffect, useRef, useState } from "react";
import { ru } from "@/i18n/ru";
import { toast, Uploader, type UploaderItem } from "@/kit";

const t = ru.app.kit.showcase.master;

const START_ITEMS: UploaderItem[] = [
  { id: "a", name: t.uploaderNames[0], state: "done", kind: "document" },
  { id: "b", name: t.uploaderNames[1], state: "done" },
];

/** Загрузка фото и PDF с камерой: PDF — значок документа, фото — превью; адреса превью освобождает образец. */
export function DocsUploaderSample() {
  const [items, setItems] = useState<UploaderItem[]>(START_ITEMS);
  const blobs = useRef(new Set<string>());
  useEffect(() => {
    const created = blobs.current;
    return () => {
      for (const url of created) URL.revokeObjectURL(url);
      created.clear();
    };
  }, []);
  return (
    <Uploader
      items={items}
      max={4}
      accept="image/*,application/pdf"
      capture="environment"
      label={t.uploaderLabel}
      onAdd={(files) =>
        setItems((current) => [
          ...current,
          ...files.map((file, index) => {
            const document = file.type === "application/pdf";
            const previewUrl = document ? undefined : URL.createObjectURL(file);
            if (previewUrl) blobs.current.add(previewUrl);
            return { id: `${Date.now()}-${index}`, name: file.name, state: "done" as const, previewUrl, kind: document ? ("document" as const) : ("image" as const) };
          }),
        ])
      }
      onReject={(_files, reason) => toast(reason === "type" ? t.uploaderRejectType : t.uploaderRejectLimit)}
      onRemove={(id) => {
        const gone = items.find((item) => item.id === id)?.previewUrl;
        if (gone && blobs.current.delete(gone)) URL.revokeObjectURL(gone);
        setItems((current) => current.filter((item) => item.id !== id));
      }}
    />
  );
}
