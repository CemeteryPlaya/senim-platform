import { describe, expect, it } from "vitest";
import { TOKENS } from "@/kit/tokens";
import manifest from "./manifest";

describe("манифест PWA", () => {
  const m = manifest();

  it("старт — новый интерфейс, область и id прежние (установленные приложения не ломаются)", () => {
    expect(m.start_url).toBe("/v2");
    expect(m.scope).toBe("/");
    expect(m.id).toBe("/");
  });

  it("цвета — токены v2, а не зелёный и холодный фон v1", () => {
    expect(m.theme_color).toBe(TOKENS.light.canvas);
    expect(m.background_color).toBe(TOKENS.light.canvas);
  });

  it("значки без изменений: 192, 512 и maskable", () => {
    expect(m.icons?.map((i) => i.src)).toEqual(["/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-maskable-512.png"]);
  });
});
