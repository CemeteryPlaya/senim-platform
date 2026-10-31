"use client";

import { useEffect, useReducer, useRef, type ReactNode } from "react";
import type { UploadPurpose } from "@/modules/files/client";
import { ru } from "@/i18n/ru";
import { PhotoUpload } from "@/ui";
import { createUploadAction, discardUploadAction, finalizeUploadAction } from "./actions";
import { doneFileIds, initialState, isUploading, toPhotoItems, uploaderReducer } from "./state";
import { contentTypeOf, sendToTarget } from "./transfer";

export type UploaderProps = {
  /** Назначение файлов: от него зависят права, лимиты и куда их потом прикрепит модуль-владелец. */
  purpose: UploadPurpose;
  label: ReactNode;
  hint?: ReactNode;
  /** Ошибка поля от формы (например, «Добавьте хотя бы одно фото»). */
  error?: ReactNode;
  max?: number;
  cameraHint?: ReactNode;
  chooseHint?: ReactNode;
  disabled?: boolean;
  /** Уже сохранённые файлы (редактирование): id и адрес из fileUrl(). */
  initial?: readonly { id: string; url: string }[];
  /** id загруженных файлов в порядке на экране — при каждом изменении. */
  onChange?: (fileIds: string[]) => void;
  /** Идёт ли загрузка хоть одного фото — при каждом изменении (форма не отправляет, пока true). */
  onBusyChange?: (busy: boolean) => void;
  /** Если задано — скрытые поля <input name={name}> с id файлов для обычной отправки формы. */
  name?: string;
};

const errorText = (e: unknown) => (e instanceof Error && e.message ? e.message : ru.files.uploader.failed);

/**
 * Загрузка фото: PhotoUpload из @/ui + прямая загрузка в хранилище.
 * createUpload (Server Action) → PUT байтов по подписанной цели → finalizeUpload (Server Action).
 * Наружу отдаёт только id файлов; прикрепляет их к заявке/этапу модуль-владелец (files.attachFiles).
 */
export function Uploader({ purpose, initial = [], onChange, onBusyChange, name, max, ...view }: UploaderProps) {
  const [state, dispatch] = useReducer(uploaderReducer, initial, initialState);
  const files = useRef(new Map<string, File>());
  const previews = useRef(new Set<string>());
  const ids = doneFileIds(state);
  const idsKey = ids.join(",");

  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  const reported = useRef(idsKey);
  useEffect(() => {
    if (reported.current === idsKey) return;
    reported.current = idsKey;
    onChangeRef.current?.(idsKey ? idsKey.split(",") : []);
  }, [idsKey]);

  const busy = isUploading(state);
  const onBusyRef = useRef(onBusyChange);
  useEffect(() => {
    onBusyRef.current = onBusyChange;
  });
  useEffect(() => {
    onBusyRef.current?.(busy);
  }, [busy]);

  useEffect(() => {
    const urls = previews.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  async function upload(localId: string) {
    const file = files.current.get(localId);
    if (!file) return;
    try {
      const created = await createUploadAction({ purpose, contentType: contentTypeOf(file), size: file.size });
      if (!created.ok) throw new Error(created.error);
      await sendToTarget(created.data.target, file, (progress) => dispatch({ type: "progress", localId, progress }));
      const saved = await finalizeUploadAction({ token: created.data.token });
      if (!saved.ok) throw new Error(saved.error);
      dispatch({ type: "done", localId, fileId: saved.data.id, url: saved.data.url });
    } catch (e) {
      // Сетевые ошибки браузера — общий текст; ошибки проверки сервера — его понятный текст.
      dispatch({ type: "failed", localId, error: e instanceof TypeError ? ru.files.uploader.failed : errorText(e) });
    }
  }

  function add(selected: File[]) {
    const items = selected.map((file) => {
      const localId = crypto.randomUUID();
      const src = URL.createObjectURL(file);
      files.current.set(localId, file);
      previews.current.add(src);
      return { localId, src };
    });
    dispatch({ type: "added", items });
    for (const item of items) void upload(item.localId);
  }

  function remove(localId: string) {
    const item = state.items.find((i) => i.localId === localId);
    dispatch({ type: "removed", localId });
    files.current.delete(localId);
    if (item && item.src.startsWith("blob:")) {
      URL.revokeObjectURL(item.src);
      previews.current.delete(item.src);
    }
    // Новый, ещё не прикреплённый файл удаляем на сервере; сохранённый отвяжет модуль-владелец при сохранении формы.
    if (item?.status === "done" && !initial.some((f) => f.id === item.fileId)) {
      void discardUploadAction({ fileId: item.fileId });
    }
  }

  function retry(localId: string) {
    dispatch({ type: "retrying", localId });
    void upload(localId);
  }

  return (
    <>
      <PhotoUpload {...view} max={max} photos={toPhotoItems(state)} onAdd={add} onRemove={remove} onRetry={retry} />
      {name && ids.map((id) => <input key={id} type="hidden" name={name} value={id} />)}
    </>
  );
}
