"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { ru } from "@/i18n/ru";
import { doneFileIds, initialState, isUploading, uploaderReducer, type UploaderState } from "@/features/upload/state";
import { resizePhoto } from "@/features/upload/resize";
import { contentTypeOf, isHeic, sendToTarget } from "@/features/upload/transfer";
import type { UploaderItem } from "@/kit";
import type { UploadPurpose } from "@/modules/files/client";
import type { ActionResult } from "@/platform/action";
import { randomKey } from "../../_shell/client-key";
import { outcomeOf } from "../../_shell/form";
import { createUploadAction, discardUploadAction, finalizeUploadAction } from "./actions";

/** Уже сохранённое фото (редактирование): id файла и адрес превью из хранилища. */
export type SavedPhoto = { id: string; src: string };

export type PhotoUploads = {
  /** Файлы для `Uploader` из kit. */
  items: UploaderItem[];
  /** id загруженных файлов в порядке на экране — их сохраняет форма. */
  fileIds: string[];
  /** Идёт загрузка хоть одного файла: форме рано отправлять `fileIds`. */
  busy: boolean;
  add: (files: File[]) => void;
  remove: (id: string) => void;
  retry: (id: string) => void;
};

/** Сбой загрузки: результат действия (его текст по-русски) или исключение сети и хранилища (общий текст). */
class UploadFailed extends Error {}

/** Файлы автомата `src/features/upload` → пропсы `Uploader` kit. Имя файла — из выбора, у сохранённых — «Фото N». */
export function uploaderItems(state: UploaderState, names: ReadonlyMap<string, string>, savedName: (n: number) => string): UploaderItem[] {
  return state.items.map((item, index) => {
    const base = { id: item.localId, name: names.get(item.localId) ?? savedName(index + 1), previewUrl: item.src };
    switch (item.status) {
      case "uploading":
        return { ...base, state: "uploading", progress: item.progress };
      case "error":
        return { ...base, state: "error", error: item.error };
      case "done":
        return { ...base, state: "done" };
    }
  });
}

/**
 * Загрузка фото для `Uploader` kit: автомат `uploaderReducer` и прямая загрузка в хранилище, как в v1 — createUpload
 * (Server Action) → PUT байтов по подписанной цели (`sendToTarget`, с ходом) → finalizeUpload. HEIC: тип по расширению
 * (`contentTypeOf`), превью — с сервера (браузер его не покажет). «Сессия истекла» и «нужно согласие» уводят на экран v2
 * с возвратом (`outcomeOf`). Убранный новый файл удаляется на сервере; сохранённый открепит модуль-владелец при
 * сохранении формы. Адреса превью (`blob:`) освобождаются при удалении и размонтировании.
 */
export function usePhotoUploads(purpose: UploadPurpose, saved: readonly SavedPhoto[], savedName: (n: number) => string): PhotoUploads {
  const [state, dispatch] = useReducer(
    uploaderReducer,
    saved.map((p) => ({ id: p.id, url: p.src })),
    initialState,
  );
  const files = useRef(new Map<string, File>());
  /** Имена выбранных файлов (подпись превью и кнопок «Убрать: …»): автомат их не хранит. */
  const [names, setNames] = useState<ReadonlyMap<string, string>>(() => new Map());
  const blobs = useRef(new Set<string>());
  const savedIds = useRef(new Set(saved.map((p) => p.id)));

  useEffect(() => {
    const created = blobs.current;
    return () => {
      for (const url of created) URL.revokeObjectURL(url);
      created.clear();
    };
  }, []);

  /** Ответ действия: успех — данные; уход со страницы — `null`; ошибка — исключение с текстом сервиса. */
  function settle<T>(result: ActionResult<T>): T | null {
    const outcome = outcomeOf(result, window.location);
    if (outcome.kind === "success") return outcome.data;
    if (outcome.kind === "leave") {
      window.location.assign(outcome.href);
      return null;
    }
    throw new UploadFailed(outcome.error);
  }

  async function upload(localId: string) {
    const picked = files.current.get(localId);
    if (!picked) return;
    try {
      // Большое фото уменьшается на телефоне до загрузки (HEIC и PDF — как есть); повтор берёт исходный выбор.
      const file = await resizePhoto(picked);
      const created = settle(await createUploadAction({ purpose, contentType: contentTypeOf(file), size: file.size }));
      if (!created) return;
      await sendToTarget(created.target, file, (progress) => dispatch({ type: "progress", localId, progress }));
      const done = settle(await finalizeUploadAction({ token: created.token }));
      if (!done) return;
      dispatch({ type: "done", localId, fileId: done.id, url: done.url, serverPreview: isHeic(picked) });
    } catch (e) {
      // Отказ сервиса — его понятный текст; сеть, хранилище и прочее — общий текст (подробности не показываем).
      dispatch({ type: "failed", localId, error: e instanceof UploadFailed && e.message ? e.message : ru.files.uploader.failed });
    }
  }

  function add(selected: File[]) {
    const items = selected.map((file) => {
      const localId = randomKey();
      const src = URL.createObjectURL(file);
      files.current.set(localId, file);
      blobs.current.add(src);
      return { localId, src, name: file.name };
    });
    setNames((current) => new Map([...current, ...items.map((item) => [item.localId, item.name] as const)]));
    dispatch({ type: "added", items: items.map(({ localId, src }) => ({ localId, src })) });
    for (const item of items) void upload(item.localId);
  }

  function remove(localId: string) {
    const item = state.items.find((i) => i.localId === localId);
    dispatch({ type: "removed", localId });
    files.current.delete(localId);
    if (item && blobs.current.delete(item.src)) URL.revokeObjectURL(item.src);
    if (item?.status === "done" && !savedIds.current.has(item.fileId)) void discardUploadAction({ fileId: item.fileId });
  }

  function retry(localId: string) {
    dispatch({ type: "retrying", localId });
    void upload(localId);
  }

  return {
    items: uploaderItems(state, names, savedName),
    fileIds: doneFileIds(state),
    busy: isUploading(state),
    add,
    remove,
    retry,
  };
}
