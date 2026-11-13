import { afterEach, describe, expect, it, vi } from "vitest";
import { count, html, text } from "@/kit/test-utils";
import { ru } from "@/i18n/ru";
import { ResendButton, RoleStep } from "./LoginFlow";

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

describe("RoleStep: покупатель или мастер", () => {
  const role = ru.app.login.role;

  /** Отмеченная карточка: значение радио с атрибутом checked. */
  const checkedValue = (out: string) =>
    /<input[^>]*value="(\w+)"[^>]*checked=""|<input[^>]*checked=""[^>]*value="(\w+)"/.exec(out)?.slice(1).find(Boolean);

  it("по умолчанию выбран «Я покупатель»; у обеих карточек есть описание", () => {
    const out = html(<RoleStep role="client" next={null} />);
    expect(checkedValue(out)).toBe("client");
    expect(count(out, 'checked=""')).toBe(1);
    for (const piece of [role.title, role.client, role.clientDescription, role.executor, role.executorDescription])
      expect(text(<RoleStep role="client" next={null} />)).toContain(piece);
  });

  it("выбор из cookie или адреса — «Я мастер»", () => {
    expect(checkedValue(html(<RoleStep role="executor" next={null} />))).toBe("executor");
  });

  it("в доке одна кнопка «Продолжить»; «Уже есть аккаунт? Войти» — ссылка вне дока", () => {
    const out = html(<RoleStep role="client" next="/v2/about" />);
    expect(count(out, "data-primary-action")).toBe(1);
    const dock = out.slice(out.indexOf("data-action-dock"));
    expect(dock).toContain(role.submit);
    expect(dock).not.toContain(role.haveAccount);
    expect(out).toContain(`href="/v2/login?step=phone&amp;next=%2Fv2%2Fabout"`);
  });
});
