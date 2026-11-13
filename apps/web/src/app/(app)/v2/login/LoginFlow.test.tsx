import { afterEach, describe, expect, it, vi } from "vitest";
import { text } from "@/kit/test-utils";
import { ru } from "@/i18n/ru";
import { ResendButton } from "./LoginFlow";

const t = ru.app.login.code;
const NOW = Date.UTC(2026, 10, 13, 10, 0, 0);

afterEach(() => {
  vi.useRealTimers();
});

describe("ResendButton: первая отрисовка считает от момента, когда можно запросить снова", () => {
  it("осталось 25 с — «через 0:25», а не «через 1:00»", () => {
    vi.useFakeTimers({ now: NOW });
    expect(text(<ResendButton until={NOW + 25_000} pending={false} />)).toBe(t.resendIn(25));
  });

  it("срок прошёл (вернулись «Назад» браузера через минуту) — кнопка сразу доступна", () => {
    vi.useFakeTimers({ now: NOW });
    expect(text(<ResendButton until={NOW - 1_000} pending={false} />)).toBe(t.resend);
  });

  it("только что отправили — «через 1:00»", () => {
    vi.useFakeTimers({ now: NOW });
    expect(text(<ResendButton until={NOW + 60_000} pending={false} />)).toBe(t.resendIn(60));
  });
});
