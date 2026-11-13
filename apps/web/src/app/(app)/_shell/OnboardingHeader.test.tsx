import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { count, html, text } from "@/kit/test-utils";
import { OnboardingHeader } from "./OnboardingHeader";

describe("OnboardingHeader: счётчик анкеты", () => {
  it("«Анкета: шаг N из 3», полоса, один h1", () => {
    const el = <OnboardingHeader step={2} total={3} title="Заголовок" />;
    expect(text(el)).toContain("Анкета: шаг 2 из 3");
    expect(ru.app.onboarding.step(2, 3)).toBe("Анкета: шаг 2 из 3");
    const out = html(el);
    expect(out).toContain('role="progressbar"');
    expect(out).toContain('aria-valuenow="2"');
    expect(count(out, "<h1")).toBe(1);
  });

  it("на компьютере строка счётчика той же высоты, что «Назад» (min-h-control-sm), без отрицательных полей", () => {
    const out = html(<OnboardingHeader step={1} total={3} title="Заголовок" />);
    expect(out).toContain("desktop:min-h-control-sm");
    expect(out).not.toMatch(/class="[^"]*(^|\s)-m[a-z]?-/);
  });
});
