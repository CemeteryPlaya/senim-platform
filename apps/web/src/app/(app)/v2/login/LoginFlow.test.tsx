import { afterEach, describe, expect, it, vi } from "vitest";
import { count, hasClass, html, text } from "@/kit/test-utils";
import { ru } from "@/i18n/ru";
import { CodeStep, RoleStep } from "./LoginFlow";


const t = ru.app.login.code;
const NOW = Date.UTC(2026, 10, 13, 10, 0, 0);

afterEach(() => {
  vi.useRealTimers();
});

describe("CodeStep: поле → «Войти» → повтор; к номеру — «Назад»", () => {
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

  it("телефон: поле, повтор, док последним; ссылки «Изменить номер» нет — к номеру ведёт «Назад»", () => {
    vi.useFakeTimers({ now: NOW });
    const out = html(render());
    expect(at(out, 'name="code"')).toBeLessThan(at(out, "data-resend-code"));
    expect(at(out, "data-resend-code")).toBeLessThan(at(out, "data-action-dock"));
    expect(out).not.toContain("Изменить номер");
    expect(count(out, 'href="/v2/login?step=phone')).toBe(1);
    expect(out).toContain(t.backLabel);
  });

  it("компьютер: «Войти» над повтором", () => {
    vi.useFakeTimers({ now: NOW });
    const out = html(render({}, "desktop"));
    expect(at(out, 'name="code"')).toBeLessThan(at(out, "data-action-dock"));
    expect(at(out, "data-action-dock")).toBeLessThan(at(out, "data-resend-code"));
  });

  it("подпись поля кода — только для диктора: поле одно, его называет заголовок", () => {
    vi.useFakeTimers({ now: NOW });
    const out = html(render());
    expect(out).toMatch(new RegExp(`<label for="[^"]+" class="sr-only">${t.label}</label>`));
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

  it("по умолчанию выбран «Я покупатель»; у карточек только подписи, без описаний", () => {
    const out = html(<RoleStep role="client" next={null} />);
    expect(checkedValue(out)).toBe("client");
    expect(count(out, 'checked=""')).toBe(1);
    for (const piece of [role.title, role.client, role.executor]) expect(text(<RoleStep role="client" next={null} />)).toContain(piece);
    expect(out).not.toContain("-description");
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
  });

  it("«Войти по номеру» — действие (забывает прежний выбор роли), а не ссылка: тихая кнопка 48 px, не главная", () => {
    const out = html(<RoleStep role="client" next="/v2/about" />);
    const label = role.haveAccount.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const button = out.match(new RegExp(`<button[^>]*>(?:(?!</button>).)*${label}(?:(?!</button>).)*</button>`))?.[0];
    expect(button).toBeDefined();
    expect(hasClass(button!, "min-h-control")).toBe(true);
    expect(button).not.toContain("data-primary-action");
    expect(out).not.toContain("href=\"/v2/login?step=phone");
  });
});
