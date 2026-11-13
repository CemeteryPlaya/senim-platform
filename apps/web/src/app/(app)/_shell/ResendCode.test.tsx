import { afterEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { hasClass, html, text } from "@/kit/test-utils";
import { ResendCode } from "./ResendCode";

const t = ru.app.login.code;
const NOW = Date.UTC(2026, 10, 13, 10, 0, 0);

const render = (until: number, pending = false) => (
  <ResendCode until={until} form="resend" pending={pending} label={t.resend} waitLabel={t.resendIn} />
);

afterEach(() => {
  vi.useRealTimers();
});

describe("ResendCode: отсчёт — строка текста, после — тихая кнопка", () => {
  it("осталось 25 с — строка «через 0:25» (от `until`, а не «1:00»): не кнопка, вторичный текст 15 px, без aria-live", () => {
    vi.useFakeTimers({ now: NOW });
    const out = html(render(NOW + 25_000));
    expect(text(render(NOW + 25_000))).toBe(t.resendIn(25));
    expect(out).not.toContain("<button");
    expect(out).toMatch(/<p class="[^"]*text-sub[^"]*text-muted/);
    expect(out).not.toContain("aria-live");
    expect(out).not.toContain('role="status"');
  });

  it("только что отправили — «через 1:00»", () => {
    vi.useFakeTimers({ now: NOW });
    expect(text(render(NOW + 60_000))).toBe(t.resendIn(60));
  });

  it("срок прошёл — тихая кнопка отправки формы повтора, доступная сразу", () => {
    vi.useFakeTimers({ now: NOW });
    const out = html(render(NOW - 1_000));
    expect(text(render(NOW - 1_000))).toBe(t.resend);
    expect(out).toMatch(/<button(?=[^>]*type="submit")(?=[^>]*form="resend")[^>]*>/);
    expect(out).not.toMatch(/<button[^>]*disabled=""/);
    expect(out).not.toContain("data-primary-action");
    // По левой линии содержимого: тихая кнопка без боковых отступов.
    expect(hasClass(out, "px-4")).toBe(false);
  });

  it("высота строки одинакова в обоих состояниях (поле касания 48 px) — смена состояния ничего не сдвигает", () => {
    vi.useFakeTimers({ now: NOW });
    for (const until of [NOW + 25_000, NOW - 1_000]) {
      const out = html(render(until));
      expect(out).toMatch(/^<div data-resend-code="true"/);
      expect(hasClass(out, "min-h-control")).toBe(true);
      expect(hasClass(out, "px-4") || hasClass(out, "px-6")).toBe(false);
    }
  });
});
