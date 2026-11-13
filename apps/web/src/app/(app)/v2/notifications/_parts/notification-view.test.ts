import { describe, expect, it } from "vitest";
import { hasUnread, notificationRows } from "./notification-view";

const NOW = new Date("2026-11-14T10:00:00.000Z");

describe("строки уведомлений", () => {
  it("непрочитанное — по readAt, время словами", () => {
    const rows = notificationRows(
      [
        { id: "a", title: "Новое предложение", body: "Цена и срок", createdAt: new Date("2026-11-14T09:55:00.000Z"), readAt: null },
        { id: "b", title: "Сообщение", body: "Текст", createdAt: new Date("2026-11-13T09:55:00.000Z"), readAt: new Date("2026-11-13T10:00:00.000Z") },
      ],
      NOW,
    );
    expect(rows.map((r) => [r.id, r.unread])).toEqual([["a", true], ["b", false]]);
    expect(rows[0].time).toContain("минут");
    expect(hasUnread(rows)).toBe(true);
    expect(hasUnread(rows.slice(1))).toBe(false);
  });
});
