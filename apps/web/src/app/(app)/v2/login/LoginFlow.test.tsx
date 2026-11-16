import { afterEach, describe, expect, it, vi } from "vitest";
import { count, html, text } from "@/kit/test-utils";
import { ru } from "@/i18n/ru";
import { CodeStep, RoleStep } from "./LoginFlow";


const t = ru.app.login.code;
const NOW = Date.UTC(2026, 10, 13, 10, 0, 0);

afterEach(() => {
  vi.useRealTimers();
});

describe("CodeStep: поле → «Войти» → повтор → «Изменить номер»", () => {
  type Sent = Parameters<typeof CodeStep>[0]["sent"];
  const sent: Sent = { phone: "+7 700 000 66 01", shownCode: "123456", retryAt: NOW + 60_000, notice: "none" };
  const render = (over: Partial<Sent> = {}, device: "mobile" | "desktop" = "mobile") => (
    <CodeStep next={null} device={device} sent={{ ...sent, ...over }} onResent={() => {}} />
  );
  const at = (out: string, needle: string) => {
    const i = out.indexOf(needle);
    if (i < 0) throw new Error(`нет в разметке: ${needle}`);
    return i;
  };

  it("во время отсчёта повтор — строка текста: единственная кнопка — «Войти» в доке", () => {
    vi.useFakeTimers({ now: NOW });
    const out = html(render());
    expect(count(out, "<button")).toBe(1);
    expect(out.slice(out.indexOf("data-action-dock"))).toContain(t.submit);
    expect(text(render())).toContain(t.resendIn(60));
  });

  it("телефон: поле, повтор, «Изменить номер», док последним", () => {
    vi.useFakeTimers({ now: NOW });
    const out = html(render());
    expect(at(out, 'name="code"')).toBeLessThan(at(out, "data-resend-code"));
    expect(at(out, "data-resend-code")).toBeLessThan(at(out, t.changePhone));
    expect(at(out, t.changePhone)).toBeLessThan(at(out, "data-action-dock"));
  });

  it("компьютер: «Войти» над повтором и ссылкой", () => {
    vi.useFakeTimers({ now: NOW });
    const out = html(render({}, "desktop"));
    expect(at(out, 'name="code"')).toBeLessThan(at(out, "data-action-dock"));
    expect(at(out, "data-action-dock")).toBeLessThan(at(out, "data-resend-code"));
    expect(at(out, "data-resend-code")).toBeLessThan(at(out, t.changePhone));
  });

  it("плашка кода: первая фраза, затем «Ваш код: NNNNNN» отдельной строкой с tabular-nums; один h1; счётчика шагов нет", () => {
    vi.useFakeTimers({ now: NOW });
    const out = html(render());
    expect(out).toContain(`<span class="block">${t.shownLead}</span><span class="block tabular-nums">${t.shownCode("123456")}</span>`);
    expect(count(out, "<h1")).toBe(1);
    expect(count(out, "data-primary-action")).toBe(1);
    expect(out).not.toMatch(/Шаг \d из|Анкета|progressbar/);
  });

  it("код уже был отправлен — пояснение; новый отправлен — «Отправили новый код»", () => {
    vi.useFakeTimers({ now: NOW });
    expect(text(render({ notice: "alreadySent", shownCode: null }))).toContain(t.alreadySent);
    expect(text(render({ notice: "resent" }))).toContain(t.resent);
    expect(text(render())).not.toContain(t.alreadySent);
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

  it("имя группы для диктора — вопрос шага; видимой подписи группы нет", () => {
    const out = html(<RoleStep role="client" next={null} />);
    expect(out).toContain(`<legend class="sr-only">${role.title}</legend>`);
    expect(out.match(/<legend/g)).toHaveLength(1);
  });

  it("выбор из cookie или адреса — «Я мастер»", () => {
    expect(checkedValue(html(<RoleStep role="executor" next={null} />))).toBe("executor");
  });

  it("первый шаг без счётчика и полосы, «Назад» с названием родителя; ссылка «Уже регистрировались? Войти по номеру»", () => {
    const out = html(<RoleStep role="client" next={null} />);
    expect(out).not.toMatch(/Шаг \d из|Анкета|progressbar/);
    expect(count(out, "<h1")).toBe(1);
    expect(text(<RoleStep role="client" next={null} />)).toContain(role.backLabel);
    expect(role.haveAccount).toBe("Уже регистрировались? Войти по номеру");
    expect(text(<RoleStep role="client" next={null} />)).toContain(role.haveAccount);
  });

  it("в доке одна кнопка «Продолжить»; ссылка «Войти по номеру» — вне дока", () => {
    const out = html(<RoleStep role="client" next="/v2/about" />);
    expect(count(out, "data-primary-action")).toBe(1);
    const dock = out.slice(out.indexOf("data-action-dock"));
    expect(dock).toContain(role.submit);
    expect(dock).not.toContain(role.haveAccount);
    expect(out).toContain(`href="/v2/login?step=phone&amp;next=%2Fv2%2Fabout"`);
  });
});
