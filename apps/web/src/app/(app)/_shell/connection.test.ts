import { describe, expect, it } from "vitest";
import { RETURN_REFRESH_MS, shouldRefreshOnReconnect, shouldRefreshOnReturn } from "./connection";

describe("обновление экрана при возврате в приложение", () => {
  const t0 = 1_000_000;

  it("скрыт дольше порога и давно не обновлялся — перечитать", () => {
    expect(shouldRefreshOnReturn({ hiddenAt: t0, refreshedAt: t0 - 5_000 }, t0 + RETURN_REFRESH_MS, true)).toBe(true);
  });

  it("короткое переключение вкладки — не трогать сервер", () => {
    expect(shouldRefreshOnReturn({ hiddenAt: t0, refreshedAt: 0 }, t0 + RETURN_REFRESH_MS - 1, true)).toBe(false);
  });

  it("обновлялся недавно (связь только что вернулась) — не чаще раза в порог", () => {
    expect(shouldRefreshOnReturn({ hiddenAt: t0, refreshedAt: t0 + RETURN_REFRESH_MS }, t0 + RETURN_REFRESH_MS + 1_000, true)).toBe(false);
  });

  it("без сети — не обновлять (обновит возврат связи); не скрывался — не обновлять", () => {
    expect(shouldRefreshOnReturn({ hiddenAt: t0, refreshedAt: 0 }, t0 + 10 * RETURN_REFRESH_MS, false)).toBe(false);
    expect(shouldRefreshOnReturn({ hiddenAt: null, refreshedAt: 0 }, t0, true)).toBe(false);
  });
});

describe("возврат связи", () => {
  it("перечитать только при переходе «нет сети → есть»", () => {
    expect(shouldRefreshOnReconnect(false, true)).toBe(true);
    expect(shouldRefreshOnReconnect(true, true)).toBe(false);
    expect(shouldRefreshOnReconnect(true, false)).toBe(false);
    expect(shouldRefreshOnReconnect(false, false)).toBe(false);
  });
});
