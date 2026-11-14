import { describe, expect, it } from "vitest";
import type { ChatRoomModel } from "./chat-view";
import { mergeRoom, URL_REFRESH_MS, type RoomState } from "./room-state";

const room = (url: string, extra: string[] = []): ChatRoomModel => ({
  messages: [
    { id: "m1", text: "Фото", time: "10:00", attachments: [{ id: "f1", name: "Фото 1", url, previewUrl: url }] },
    ...extra.map((id) => ({ id, text: id, time: "10:01", attachments: [{ id: `${id}-f`, name: "Фото 1", url: `/new/${id}`, previewUrl: `/new/${id}` }] })),
  ],
  canWrite: true,
  closedReason: null,
  operatorReason: null,
  beforeOffer: false,
});

describe("адреса фото между опросами", () => {
  const start: RoomState = { model: room("/api/files/a?sig=1"), urlsAt: 1_000 };

  it("после двух опросов адрес известного файла прежний, новое сообщение получает свой", () => {
    const first = mergeRoom(start, room("/api/files/a?sig=2"), 6_000);
    const second = mergeRoom(first, room("/api/files/a?sig=3", ["m2"]), 11_000);
    const known = second.model.messages[0].attachments?.[0];
    expect(known?.url).toBe("/api/files/a?sig=1");
    expect(known?.previewUrl).toBe("/api/files/a?sig=1");
    expect(second.model.messages[1].attachments?.[0].url).toBe("/new/m2");
    expect(second.urlsAt).toBe(1_000);
  });

  it("раз в 10 минут адреса обновляются целиком (срок подписи 15 минут)", () => {
    const refreshed = mergeRoom(start, room("/api/files/a?sig=9"), 1_000 + URL_REFRESH_MS);
    expect(refreshed.model.messages[0].attachments?.[0].url).toBe("/api/files/a?sig=9");
    expect(refreshed.urlsAt).toBe(1_000 + URL_REFRESH_MS);
  });

  it("остальное берётся из нового ответа (новые сообщения, статус чата)", () => {
    const next = { ...room("/x", ["m2"]), canWrite: false, closedReason: "закрыт" };
    const merged = mergeRoom(start, next, 2_000);
    expect(merged.model).toMatchObject({ canWrite: false, closedReason: "закрыт" });
    expect(merged.model.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
  });
});
