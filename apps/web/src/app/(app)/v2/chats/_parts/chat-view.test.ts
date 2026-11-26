import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import type { ChatListItem, ChatView } from "@/modules/companies";
import { formatTime } from "@/features/format/format";
import { chatHref, chatRoomModel, chatRows, closedText, contextLink, contextOf, counterpartOf, dayLabel, messageTime, rowTime } from "./chat-view";
import { createGate, shouldPoll } from "./single-flight";

const t = ru.app.chat;
const NOW = new Date("2026-11-14T10:00:00.000Z");

const view = (over: Partial<ChatView> = {}): ChatView => ({
  offerId: "o1",
  requestId: "r1",
  dealId: null,
  title: "Кухня · Астана",
  counterpart: "Исполнитель №7",
  attachments: [],
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

describe("время и разделители дней", () => {
  it("у сообщения — только часы и минуты", () => {
    expect(messageTime(new Date("2026-11-12T08:05:00.000Z"))).toMatch(/^\d{2}:\d{2}$/);
  });
  it("сегодня, вчера, раньше — «12 ноября», другой год — с годом", () => {
    expect(dayLabel(new Date("2026-11-14T08:05:00.000Z"), NOW)).toBe("Сегодня");
    expect(dayLabel(new Date("2026-11-13T08:05:00.000Z"), NOW)).toBe("Вчера");
    expect(dayLabel(new Date("2026-11-12T08:05:00.000Z"), NOW)).toBe("12 ноября");
    expect(dayLabel(new Date("2025-11-12T08:05:00.000Z"), NOW)).toBe("12 ноября 2025");
  });
  it("в ленте разделитель стоит один раз над сообщениями дня", () => {
    const model = chatRoomModel(
      view({
        contacts: { phone: "+7" } as unknown as ChatView["contacts"],
        messages: [
          { id: "a", kind: "other", author: "x", text: "1", sentAt: new Date("2026-11-12T08:00:00.000Z"), masked: false, attachments: [] },
          { id: "b", kind: "own", author: "Вы", text: "2", sentAt: new Date("2026-11-12T09:00:00.000Z"), masked: false, attachments: [] },
          { id: "c", kind: "own", author: "Вы", text: "3", sentAt: new Date("2026-11-14T09:00:00.000Z"), masked: false, attachments: [] },
        ],
      }),
      NOW,
    );
    expect(model.messages.map((m) => [m.kind ?? "message", m.id.startsWith("day:") ? m.text : m.id])).toEqual([
      ["day", "12 ноября"],
      ["message", "a"],
      ["message", "b"],
      ["day", "Сегодня"],
      ["message", "c"],
    ]);
  });
});

describe("модель ленты", () => {
  it("до оферты — без системной строки о контактах (о них — строка под заголовком); свои справа, автор для диктора из модуля", () => {
    const model = chatRoomModel(view(), NOW);
    expect(model.beforeOffer).toBe(true);
    expect(model.messages.some((m) => m.kind === "system")).toBe(false);
    expect(model.messages.filter((m) => m.kind !== "day").map((m) => [m.id, m.mine, m.author])).toEqual([
      ["m1", false, "Исполнитель №7"],
      ["m2", true, "Вы"],
    ]);
  });

  it("после оферты (контакты открыты) системной строки нет", () => {
    const model = chatRoomModel(view({ contacts: { phone: "+7 700 000 00 00" } as unknown as ChatView["contacts"] }), NOW);
    expect(model.beforeOffer).toBe(false);
    expect(model.messages.filter((m) => m.kind !== "day").map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("закрытый чат: причина и признак оператора передаются как есть", () => {
    const model = chatRoomModel(view({ canWrite: false, closedReason: "Чат закрыт оператором — можно только читать", closedCode: "operatorClosed", closedByOperator: { reason: "Жалоба", at: NOW } }), NOW);
    expect(model).toMatchObject({ canWrite: false, closedReason: t.room.closed.operatorClosed, operatorReason: "Жалоба" });
  });

  it("модель — простые значения (идёт через серверное действие): без Date", () => {
    expect(JSON.parse(JSON.stringify(chatRoomModel(view(), NOW)))).toEqual(chatRoomModel(view(), NOW));
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
      view({
        attachments: [
          { id: "f1", messageId: "m1", url: "/api/files/a" },
          { id: "f2", messageId: "m1", url: "/api/files/b" },
          { id: "f3", messageId: "m2", url: "/api/files/c" },
        ],
      }),
      NOW,
    );
    const [first, second] = model.messages.filter((m) => m.kind !== "day");
    expect(first.attachments?.map((a) => [a.id, a.name, a.url, a.previewUrl])).toEqual([
      ["f1", t.room.photo(1), "/api/files/a", "/api/files/a"],
      ["f2", t.room.photo(2), "/api/files/b", "/api/files/b"],
    ]);
    expect(second.attachments?.map((a) => a.name)).toEqual([t.room.photo(1)]);
  });
});

describe("к чему относится диалог", () => {
  it("сделка, если она есть, иначе предложение; адрес собирается через to()", () => {
    expect(contextOf({ dealId: "d1", requestId: "r1", offerId: "o1" })).toEqual({ kind: "deal", dealId: "d1" });
    expect(contextOf({ dealId: null, requestId: "r1", offerId: "o1" })).toEqual({ kind: "offer", requestId: "r1", offerId: "o1" });
    expect(contextLink({ kind: "deal", dealId: "d1" }, "Кухня · Астана")).toEqual({ href: "/v2/deals/d1", label: t.room.aboutDeal("Кухня · Астана") });
    expect(contextLink({ kind: "offer", requestId: "r1", offerId: "o1" }, null)).toEqual({ href: "/v2/requests/r1/offers/o1", label: t.room.aboutOfferShort });
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

  it("время строки: сегодня — часы и минуты, раньше — короткая дата без «назад»", () => {
    const nb = String.fromCharCode(160);
    expect(rowTime(new Date("2026-11-20T09:30:00Z"), new Date("2026-11-20T12:00:00Z"))).toBe(formatTime(new Date("2026-11-20T09:30:00Z")));
    expect(rowTime(new Date("2026-11-15T09:30:00Z"), new Date("2026-11-20T12:00:00Z"))).toBe(`15${nb}нояб`);
    expect(chatRows([item({ lastAt: new Date("2026-11-15T09:30:00Z") })], new Date("2026-11-20T12:00:00Z"))[0]?.time).not.toMatch(/назад/);
  });

  it("диалоги без сообщений в список не попадают; закрытый с сообщениями остаётся", () => {
    const rows = chatRows([item({ offerId: "empty", lastMessage: null, lastAt: null }), item({ offerId: "closed", closed: true })], NOW);
    expect(rows.map((r) => [r.offerId, r.closed])).toEqual([["closed", true]]);
    expect(chatRows([item({ lastMessage: null, lastAt: null })], NOW)).toEqual([]);
  });
});

describe("чаты мастера: собеседник, причины и «к чему относится» словами мастера", () => {
  const tm = ru.app.masterDeal.chat;
  // Модуль называет покупателя для мастера «Заказчик» — мастеру это слово не показываем.
  const masterView = (over: Partial<ChatView> = {}) =>
    view({
      counterpart: "Заказчик",
      messages: [
        { id: "m1", kind: "other", author: "Заказчик", text: "Когда начнёте?", sentAt: new Date("2026-11-14T08:05:00.000Z"), masked: false, attachments: [] },
        { id: "m2", kind: "own", author: "Вы", text: "Завтра", sentAt: new Date("2026-11-14T08:06:00.000Z"), masked: false, attachments: [] },
      ],
      ...over,
    });

  it("собеседник и автор чужих сообщений — «Покупатель»; свои — «Вы»; у покупателя — как отдал модуль", () => {
    expect(counterpartOf("Заказчик", "EXECUTOR")).toBe(tm.counterpart);
    expect(counterpartOf("Исполнитель №7", "CLIENT")).toBe("Исполнитель №7");
    const model = chatRoomModel(masterView(), NOW, "EXECUTOR");
    expect(model.messages.filter((m) => m.kind !== "day").map((m) => m.author)).toEqual([tm.counterpart, "Вы"]);
    expect(JSON.stringify(model)).not.toMatch(/заказчик/i);
  });

  it("закрытый чат — причина по коду словами мастера; без «отклик» и «заказчик»", () => {
    const codes = Object.keys(tm.room.closed) as (keyof typeof tm.room.closed)[];
    for (const closedCode of codes) {
      const text = closedText({ canWrite: false, closedCode }, "EXECUTOR");
      expect(text).toBe(tm.room.closed[closedCode]);
      expect(text).not.toMatch(/отклик|заказчик/i);
    }
    expect(chatRoomModel(masterView({ canWrite: false, closedCode: "offerWithdrawn" }), NOW, "EXECUTOR").closedReason).toBe(tm.room.closed.offerWithdrawn);
    expect(closedText({ canWrite: false, closedCode: null }, "EXECUTOR")).toBe(t.room.closedGeneric);
  });

  it("к чему относится: до сделки — заявка мастера, после — сделка", () => {
    expect(contextLink({ kind: "offer", requestId: "r1", offerId: "o1" }, "Кухня · Астана", "EXECUTOR")).toEqual({
      href: "/v2/executor/requests/r1",
      label: tm.room.aboutRequest("Кухня · Астана"),
    });
    expect(contextLink({ kind: "offer", requestId: "r/1", offerId: "o1" }, null, "EXECUTOR")).toEqual({ href: "/v2/executor/requests/r%2F1", label: tm.room.aboutRequestShort });
    expect(contextLink({ kind: "deal", dealId: "d1" }, "Кухня · Астана", "EXECUTOR").href).toBe("/v2/deals/d1");
  });

  it("строка списка мастера — «Покупатель», адрес — диалог v2", () => {
    const [row] = chatRows(
      [{ offerId: "o1", title: "Кухня · Астана", counterpart: "Заказчик", lastMessage: "Здравствуйте", lastAt: NOW, closed: false, href: "/executor/requests/r1#chat" }],
      NOW,
      "EXECUTOR",
    );
    expect(row).toMatchObject({ counterpart: tm.counterpart, href: "/v2/chats/o1" });
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
