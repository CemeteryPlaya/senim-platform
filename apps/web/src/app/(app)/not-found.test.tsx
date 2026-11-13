import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { count, html } from "@/kit/test-utils";
import NotFound from "./not-found";

const t = ru.app.shell;
const out = html(<NotFound />);

describe("«Страница не найдена» v2", () => {
  it("один <h1> — заголовок из ru, под ним пояснение", () => {
    expect(count(out, "<h1")).toBe(1);
    expect(out.match(/<h1[^>]*>([^<]*)<\/h1>/)?.[1]).toBe(t.notFoundTitle);
    expect(out).toContain(t.notFoundBody);
  });

  it("ровно одно главное действие — ссылка на главную v2", () => {
    expect(count(out, "data-primary-action")).toBe(1);
    const primary = out.match(/<a [^>]*data-primary-action[^>]*>([^<]*)<\/a>/);
    expect(primary?.[0]).toContain('href="/v2"');
    expect(primary?.[1]).toBe(t.notFoundAction);
  });

  it("нет английского текста Next по умолчанию", () => {
    expect(out).not.toMatch(/could not be found|404/i);
  });
});
