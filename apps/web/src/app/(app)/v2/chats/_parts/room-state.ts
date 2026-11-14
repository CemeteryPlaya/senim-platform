import type { ChatRoomModel } from "./chat-view";

/**
 * Адреса фото в ленте. Модуль подписывает адрес вложения заново при каждом чтении, а срок подписи у чата — 15 минут:
 * подставлять свежий адрес на каждом опросе нельзя (`<img src>` меняется, браузер качает все фото заново, лента мигает).
 * Известный файл сохраняет адрес, а целиком адреса обновляются не чаще, чем раз в 10 минут (запас до конца срока).
 */
export const URL_REFRESH_MS = 10 * 60_000;

export type RoomState = { model: ChatRoomModel; /** Когда адреса обновлялись целиком, мс. */ urlsAt: number };

export function mergeRoom(prev: RoomState, next: ChatRoomModel, now: number): RoomState {
  if (now - prev.urlsAt >= URL_REFRESH_MS) return { model: next, urlsAt: now };
  const known = new Map<string, { url: string; previewUrl?: string }>();
  for (const message of prev.model.messages) for (const file of message.attachments ?? []) known.set(file.id, { url: file.url, previewUrl: file.previewUrl });
  const messages = next.messages.map((message) => ({
    ...message,
    attachments: message.attachments?.map((file) => {
      const old = known.get(file.id);
      return old ? { ...file, url: old.url, previewUrl: old.previewUrl ?? file.previewUrl } : file;
    }),
  }));
  return { model: { ...next, messages }, urlsAt: prev.urlsAt };
}
