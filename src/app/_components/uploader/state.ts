import type { PhotoItem } from "@/ui";

/** Фото в загрузчике. Ключ на экране — localId; fileId появляется после finalizeUpload. */
type Item =
  | { localId: string; src: string; status: "uploading"; progress: number }
  | { localId: string; src: string; status: "error"; error: string }
  | { localId: string; src: string; status: "done"; fileId: string };

export type UploaderState = { items: readonly Item[] };

export type UploaderEvent =
  | { type: "added"; items: { localId: string; src: string }[] }
  | { type: "progress"; localId: string; progress: number }
  | { type: "done"; localId: string; fileId: string; url: string }
  | { type: "failed"; localId: string; error: string }
  | { type: "retrying"; localId: string }
  | { type: "removed"; localId: string };

/** Уже сохранённые файлы (редактирование): готовы, localId = id файла. */
export function initialState(saved: readonly { id: string; url: string }[]): UploaderState {
  return { items: saved.map((f) => ({ localId: f.id, src: f.url, status: "done", fileId: f.id })) };
}

function update(state: UploaderState, localId: string, next: (item: Item) => Item): UploaderState {
  return { items: state.items.map((item) => (item.localId === localId ? next(item) : item)) };
}

export function uploaderReducer(state: UploaderState, event: UploaderEvent): UploaderState {
  switch (event.type) {
    case "added":
      return { items: [...state.items, ...event.items.map((i) => ({ ...i, status: "uploading" as const, progress: 0 }))] };
    case "progress":
      return update(state, event.localId, (item) => (item.status === "uploading" ? { ...item, progress: event.progress } : item));
    case "done":
      // Превью остаётся локальным (blob:) — без лишней загрузки картинки с сервера.
      return update(state, event.localId, (item) => ({ localId: item.localId, src: item.src, status: "done", fileId: event.fileId }));
    case "failed":
      return update(state, event.localId, (item) => ({ localId: item.localId, src: item.src, status: "error", error: event.error }));
    case "retrying":
      return update(state, event.localId, (item) => ({ localId: item.localId, src: item.src, status: "uploading", progress: 0 }));
    case "removed":
      return { items: state.items.filter((item) => item.localId !== event.localId) };
  }
}

export function toPhotoItems(state: UploaderState): PhotoItem[] {
  return state.items.map((item) => {
    const base = { id: item.localId, src: item.src };
    switch (item.status) {
      case "uploading":
        return { ...base, status: "uploading", progress: item.progress };
      case "error":
        return { ...base, status: "error", error: item.error };
      case "done":
        return { ...base, status: "done" };
    }
  });
}

/** id готовых файлов в порядке на экране — это и отдаётся наружу через onChange. */
export function doneFileIds(state: UploaderState): string[] {
  return state.items.flatMap((item) => (item.status === "done" ? [item.fileId] : []));
}
