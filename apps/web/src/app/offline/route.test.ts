import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { GET } from "./route";

describe("страница «Нет связи» для сервис-воркера", () => {
  it("самодостаточный HTML на русском: тексты из ru, кнопка повтора, без внешних скриптов и стилей", async () => {
    const response = GET();
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    const html = await response.text();
    expect(html).toContain('<html lang="ru">');
    for (const text of Object.values(ru.pwa.offline)) expect(html).toContain(text);
    expect(html).toContain('onclick="location.reload()"');
    expect(html).not.toMatch(/<script|<link|src=/);
  });
});
