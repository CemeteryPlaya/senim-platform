import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { TOKENS } from "@/kit/tokens";
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

describe("страница «Нет связи» в виде нового интерфейса (?v=2)", () => {
  const v2 = () => GET(new Request("https://senim.example/offline?v=2")).text();

  it("цвета ролей v2 для обеих тем: светлая по умолчанию, тёмная по prefers-color-scheme; theme-color парой", async () => {
    const html = await v2();
    for (const theme of ["light", "dark"] as const) {
      expect(html).toContain(`--canvas: ${TOKENS[theme].canvas}`);
      expect(html).toContain(`--action: ${TOKENS[theme].action}`);
      expect(html).toContain(`--on-action: ${TOKENS[theme]["on-action"]}`);
    }
    expect(html).toContain("@media (prefers-color-scheme: dark)");
    expect(html).toContain(`<meta name="theme-color" media="(prefers-color-scheme: dark)" content="${TOKENS.dark.canvas}">`);
  });

  it("кнопка — как главная v2: графит, радиус 16 px, 52 px, вес 600 (без 700); тексты из ru, без внешних ресурсов", async () => {
    const html = await v2();
    expect(html).toMatch(/button \{[^}]*min-height: 52px;[^}]*border-radius: 16px;[^}]*background: var\(--action\)/);
    expect(html).not.toMatch(/font-weight:\s*700/);
    for (const text of Object.values(ru.pwa.offline)) expect(html).toContain(text);
    expect(html).toContain('onclick="location.reload()"');
    expect(html).not.toMatch(/<script|<link|src=/);
  });

  it("без признака — прежний вид (v1 заморожен)", async () => {
    expect(await GET(new Request("https://senim.example/offline")).text()).toBe(await GET().text());
  });
});
