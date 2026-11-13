import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import type { ChatListItem, ChatView } from "@/modules/companies";
import { chatHref, chatRoomModel, chatRows, closedText, contextLink, contextOfHref, messageTime } from "./chat-view";
import { createGate, shouldPoll } from "./single-flight";

const t = ru.app.chat;
const NOW = new Date("2026-11-14T10:00:00.000Z");

const view = (over: Partial<ChatView> = {}): ChatView => ({
  offerId: "o1",
  messages: [
    { id: "m1", kind: "other", author: "Исполнитель №7", text: "Здравствуйте", sentAt: new Date("2026-11-14T08:05:00.000Z"), masked: false, attachments: [] },
    { id: "m2", kind: "own", author: "Вы", text: "Добрый день", sentAt: new Date("2026-11-12T08:05:00.000Z"), masked: false, attachments: [] },
  ],
  canWrite: true,
  closedReason: null,
  closedCode: null,
  closedByOperator: null,
  canModerate: false,
  clientPhone: null,
  contacts: null,
  ...over,
});

describe("время сообщения", () => {
  it("сегодня — только часы и минуты, раньше — с датой", () => {
    expect(messageTime(new Date("2026-11-14T08:05:00.000Z"), NOW)).toMatch(/^\d{2}:\d{2}$/);
    expect(messageTime(new Date("2026-11-12T08:05:00.000Z"), NOW)).toContain("12 ноября");
  });
});

describe("модель ленты", () => {
  it("до оферты — системная строка первой; свои справа, автор для диктора из модуля", () => {
    const model = chatRoomModel(view(), [], NOW);
    expect(model.beforeOffer).toBe(true);
    expect(model.messages[0]).toMatchObject({ kind: "system", text: t.room.hiddenSystem });
    expect(model.messages.slice(1).map((m) => [m.id, m.mine, m.author])).toEqual([
      ["m1", false, "Исполнитель №7"],
      ["m2", true, "Вы"],
    ]);
  });

  it("после оферты (контакты открыты) системной строки нет", () => {
    const model = chatRoomModel(view({ contacts: { phone: "+7 700 000 00 00" } as unknown as ChatView["contacts"] }), [], NOW);
    expect(model.beforeOffer).toBe(false);
    expect(model.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("закрытый чат: причина и признак оператора передаются как есть", () => {
    const model = chatRoomModel(view({ canWrite: false, closedReason: "Чат закрыт оператором — можно только читать", closedCode: "operatorClosed", closedByOperator: { reason: "Жалоба", at: NOW } }), [], NOW);
    expect(model).toMatchObject({ canWrite: false, closedReason: t.room.closed.operatorClosed, operatorReason: "Жалоба" });
  });

  it("модель — простые значения (идёт через серверное действие): без Date", () => {
    expect(JSON.parse(JSON.stringify(chatRoomModel(view(), [], NOW)))).toEqual(chatRoomModel(view(), [], NOW));
  });
});

describe("закрытый чат: свои тексты по коду", () => {
  it("каждая причина модуля — текст покупателя без «отклик»; неизвестный код — общий", () => {
    const codes = ["operatorClosed", "offerWithdrawn", "offerDeclined", "requestCancelled", "dealCancelled", "dealRefunded"] as const;
    for (const code of codes) {
      const text = closedText({ canWrite: false, closedCode: code });
      expect(text).toBe(t.room.closed[code]);
      expect(text).not.toMatch(/отклик|исполнител/i);
    }
    expect(closedText({ canWrite: false, closedCode: null })).toBe(t.room.closedGeneric);
    expect(closedText({ canWrite: true, closedCode: null })).toBeNull();
  });
});

describe("вложения в ленте", () => {
  it("фото сообщения — превью-ссылки «Фото N» по порядку; чужие сообщения не получают лишнего", () => {
    const model = chatRoomModel(
      view(),
      [
        { id: "f1", messageId: "m1", url: "/api/files/a" },
        { id: "f2", messageId: "m1", url: "/api/files/b" },
        { id: "f3", messageId: "m2", url: "/api/files/c" },
      ],
      NOW,
    );
    const [, first, second] = model.messages;
    expect(first.attachments?.map((a) => [a.id, a.name, a.url, a.previewUrl])).toEqual([
      ["f1", t.room.photo(1), "/api/files/a", "/api/files/a"],
      ["f2", t.room.photo(2), "/api/files/b", "/api/files/b"],
    ]);
    expect(second.attachments?.map((a) => a.name)).toEqual([t.room.photo(1)]);
  });
});

describe("к чему относится диалог", () => {
  it("путь v1 → сделка или предложение; адрес собирается через to(), не из пути модуля", () => {
    expect(contextOfHref("/deals/d1#chat", "o1")).toEqual({ kind: "deal", dealId: "d1" });
    expect(contextOfHref("/requests/r1/offers/o1#chat", "o1")).toEqual({ kind: "offer", requestId: "r1", offerId: "o1" });
    expect(contextOfHref("/executor/requests/r1#chat", "o1")).toBeNull();
    expect(contextLink({ kind: "deal", dealId: "d1" }, "Кухня · Астана")).toEqual({ href: "/v2/deals/d1", label: t.room.aboutDeal("Кухня · Астана") });
    expect(contextLink({ kind: "offer", requestId: "r1", offerId: "o1" }, null)).toEqual({ href: "/v2/requests/r1/offers/o1", label: t.room.aboutOfferShort });
    expect(contextLink(null, "x")).toBeNull();
  });
});

describe("список диалогов", () => {
  const item = (over: Partial<ChatListItem> = {}): ChatListItem => ({
    offerId: "o1",
    title: "Кухня · Астана",
    counterpart: "Исполнитель №7",
    lastMessage: "Здравствуйте",
    lastAt: new Date("2026-11-14T09:00:00.000Z"),
    closed: false,
    href: "/requests/r1/offers/o1#chat",
    ...over,
  });

  it("адрес строки — всегда экран диалога v2, не путь модуля", () => {
    const [row] = chatRows([item()], NOW);
    expect(row.href).toBe("/v2/chats/o1");
    expect(chatHref("o1")).toBe("/v2/chats/o1");
    expect(row).toMatchObject({ counterpart: "Исполнитель №7", title: "Кухня · Астана", last: "Здравствуйте", closed: false });
    expect(row.time).toBeTruthy();
  });

  it("диалоги без сообщений в список не попадают; закрытый с сообщениями остаётся", () => {
    const rows = chatRows([item({ offerId: "empty", lastMessage: null, lastAt: null }), item({ offerId: "closed", closed: true })], NOW);
    expect(rows.map((r) => [r.offerId, r.closed])).toEqual([["closed", true]]);
    expect(chatRows([item({ lastMessage: null, lastAt: null })], NOW)).toEqual([]);
  });
});

describe("замок отправки и опрос", () => {
  it("второй вход, пока первый не вышел, отклоняется; после выхода — снова можно", () => {
    const gate = createGate();
    expect(gate.enter()).toBe(true);
    expect(gate.enter()).toBe(false);
    gate.leave();
    expect(gate.enter()).toBe(true);
  });

  it("скрытая вкладка не опрашивает", () => {
    expect(shouldPoll("visible")).toBe(true);
    expect(shouldPoll("hidden")).toBe(false);
  });
});
