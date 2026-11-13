import { beforeEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { count, html, text } from "@/kit/test-utils";
import { consentDocument, consentTextSha256 } from "@/modules/identity";

const h = vi.hoisted(() => ({
  user: null as unknown,
  chosen: null as "CLIENT" | "EXECUTOR" | null,
  form: { pending: false, error: null as string | null, fieldErrors: {} as Record<string, string> },
  /** Действие запроса кода: на шаге кода им пользуется форма повтора — у неё своё (пустое) состояние. */
  requestAction: null as unknown,
}));

vi.mock("@/modules/identity", async (original) => ({
  ...(await original<typeof import("@/modules/identity")>()),
  getCurrentUser: async () => h.user,
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ push() {}, replace() {} }),
}));
vi.mock("../../_shell/role-cookie", () => ({ recallRole: async () => h.chosen }));
vi.mock("@/platform/device", () => ({ getDevice: async () => "mobile" }));
vi.mock("../../_shell/form", () => ({
  useActionForm: (action: unknown) => ({
    ...(action === h.requestAction && h.form.fieldErrors.code ? { pending: false, error: null, fieldErrors: {} } : h.form),
    onSubmit() {},
    submit: async () => {},
  }),
}));
vi.mock("./actions", () => ({ requestEmailCodeAction: vi.fn(), verifyEmailCodeAction: vi.fn() }));

const { default: EmailPage } = await import("./page");
const { AddressStep, CodeStep, EmailFlow, sentAfter } = await import("./EmailFlow");
const { emailStepHref, parseEmailStep } = await import("./steps");
h.requestAction = (await import("./actions")).requestEmailCodeAction;

const t = ru.app.onboarding.email;
const CURRENT = { id: "c1", version: consentDocument("PD_PROCESSING").version, textSha256: consentTextSha256("PD_PROCESSING") };

/** Человек, прошедший согласие и знакомство, но не почту; поля переопределяет тест. */
function person(over: Record<string, unknown> = {}) {
  return {
    id: "u1",
    role: "CLIENT",
    roles: ["CLIENT"],
    executor: null,
    fullName: "Сапаров Ерлан",
    iinLast4: "1234",
    emailVerified: false,
    mfa: { required: false, verifiedAt: null },
    consents: [CURRENT],
    consentRevocationOpen: false,
    ...over,
  };
}

async function outcome(p: Promise<unknown>): Promise<{ redirect: string } | { page: unknown }> {
  try {
    return { page: await p };
  } catch (e) {
    const digest = (e as { digest?: string }).digest ?? "";
    if (!digest.startsWith("NEXT_REDIRECT")) throw e;
    return { redirect: digest.split(";")[2] ?? "" };
  }
}

const open = (params: Record<string, string> = {}) => outcome(EmailPage({ searchParams: Promise.resolve(params) }));
const h1 = (out: string) => out.match(/<h1[^>]*>([^<]*)<\/h1>/)?.[1];
const dockOf = (out: string) => out.slice(out.indexOf("data-action-dock"));

beforeEach(() => {
  h.user = person();
  h.chosen = null;
  h.form = { pending: false, error: null, fieldErrors: {} };
});

describe("страница почты: куда ведёт", () => {
  it("гость — на вход с возвратом туда, куда шёл", async () => {
    h.user = null;
    expect(await open({ next: "/v2/deals/1" })).toEqual({ redirect: "/v2/login?next=%2Fv2%2Fdeals%2F1" });
  });

  it("без согласия или знакомства — сначала они, с тем же возвратом", async () => {
    h.user = person({ consents: [] });
    expect(await open({ next: "/v2/deals/1" })).toEqual({ redirect: "/v2/consent?next=%2Fv2%2Fdeals%2F1" });
    h.user = person({ fullName: null, iinLast4: null });
    expect(await open({ next: "/v2/deals/1" })).toEqual({ redirect: "/v2/welcome?next=%2Fv2%2Fdeals%2F1" });
  });

  it("почта подтверждена — шаг пропускается: next, без него дом; выбравший «Я мастер» — регистрация мастера", async () => {
    h.user = person({ emailVerified: true });
    expect(await open({ next: "/v2/deals/1" })).toEqual({ redirect: "/v2/deals/1" });
    expect(await open()).toEqual({ redirect: "/v2" });
    h.chosen = "EXECUTOR";
    expect(await open()).toEqual({ redirect: "/v2/register/executor" });
  });

  it("существующий покупатель или мастер без почты — страница почты, без перехода (петли нет)", async () => {
    expect(await open({ next: "/v2/deals/1" })).toHaveProperty("page");
    h.user = person({ role: "EXECUTOR", roles: ["EXECUTOR"], executor: { id: "e1", publicNumber: 1, status: "APPROVED" } });
    expect(await open({ next: "/v2/deals/1", step: "code" })).toHaveProperty("page");
  });

  it("оператора барьер почты не касается: без почты — в его раздел, а не на шаг", async () => {
    h.user = person({ role: "OPERATOR", roles: ["OPERATOR"], mfa: { required: true, verifiedAt: new Date("2026-11-13T10:00:00Z") } });
    expect(await open()).toEqual({ redirect: "/v2/operator" });
    expect(await open({ next: "/v2/deals/1" })).toEqual({ redirect: "/v2/deals/1" });
  });

  it("чужой next отбрасывается", async () => {
    h.user = person({ emailVerified: true });
    expect(await open({ next: "https://evil.example/x" })).toEqual({ redirect: "/v2" });
  });
});

describe("шаги в адресе страницы", () => {
  it("шаг: только code, иначе адрес; адрес почты в ссылку не попадает", () => {
    expect(parseEmailStep("code")).toBe("code");
    expect(parseEmailStep("x")).toBe("address");
    expect(parseEmailStep(undefined)).toBe("address");
    expect(emailStepHref("address", null)).toBe("/v2/email");
    expect(emailStepHref("code", "/v2/deals/1")).toBe("/v2/email?step=code&next=%2Fv2%2Fdeals%2F1");
  });
});

const POSITION = { step: 3, total: 3 };

describe("шаг адреса", () => {
  const render = () => <AddressStep next={null} position={POSITION} device="mobile" email={undefined} onSent={() => {}} />;

  it("один заголовок, «Шаг 3 из 3», одно главное действие «Получить код» — единственная кнопка дока; «Назад» нет", () => {
    const out = html(render());
    expect(count(out, "<h1")).toBe(1);
    expect(h1(out)).toBe(t.address.title);
    expect(text(render())).toContain(ru.app.kit.wizard.step(3, 3));
    expect(count(out, "data-primary-action")).toBe(1);
    const dock = dockOf(out);
    expect(count(dock, "<button")).toBe(1);
    expect(dock).toContain('form="email-address"');
    expect(dock).toContain(t.address.submit);
    expect(out).not.toContain(ru.app.kit.back);
  });

  it("поле почты: type=email, autocomplete=email; форма отправляется POST", () => {
    const out = html(render());
    expect(out).toMatch(/<input(?=[^>]*name="email")(?=[^>]*type="email")(?=[^>]*autoComplete="email")[^>]*>/);
    expect(out).toMatch(/<form[^>]*method="post"/);
  });

  it("«Зачем почта» — по нажатию, текст пояснения не на экране", () => {
    expect(text(render())).toContain(t.explain.label);
    expect(text(render())).not.toContain(t.explain.body);
  });

  it("ошибка формата — у поля, без второй плашки; лимит — общей плашкой", () => {
    const invalid = ru.app.login.email.errors.invalid;
    h.form = { pending: false, error: invalid, fieldErrors: { email: invalid } };
    expect(count(text(render()), invalid)).toBe(1);
    expect(html(render())).toContain('aria-invalid="true"');
    h.form = { pending: false, error: ru.app.login.email.errors.tooOften, fieldErrors: {} };
    expect(html(render())).toContain('role="alert"');
    expect(text(render())).toContain(ru.app.login.email.errors.tooOften);
  });

  it("«Изменить адрес» возвращает прежний адрес в поле", () => {
    const out = html(<AddressStep next={null} position={POSITION} device="mobile" email="erlan@mail.kz" onSent={() => {}} />);
    expect(out).toMatch(/<input(?=[^>]*name="email")(?=[^>]*value="erlan@mail.kz")[^>]*>/);
  });

  it("шаг кода без отправленного кода (перезагрузка) — снова шаг адреса", () => {
    const out = html(<EmailFlow step="code" next={null} position={POSITION} device="mobile" />);
    expect(h1(out)).toBe(t.address.title);
  });
});

describe("шаг кода", () => {
  type Sent = Parameters<typeof CodeStep>[0]["sent"];
  const sent: Sent = { email: "erlan@mail.kz", demoCode: "123456", retryAt: Date.now() + 60_000, notice: "none" };
  const render = (over: Partial<Sent> = {}, device: "mobile" | "desktop" = "mobile") => (
    <CodeStep next="/v2/deals/1" position={POSITION} device={device} sent={{ ...sent, ...over }} onResent={() => {}} />
  );
  /** Где в разметке стоит фрагмент (для порядка элементов). */
  const at = (out: string, needle: string) => {
    const i = out.indexOf(needle);
    if (i < 0) throw new Error(`нет в разметке: ${needle}`);
    return i;
  };

  it("куда отправили, плашка с кодом, «Изменить адрес» — ссылка на шаг адреса с тем же next", () => {
    const plain = text(render());
    expect(h1(html(render()))).toBe(t.code.title);
    expect(plain).toContain(t.code.sentTo("erlan@mail.kz"));
    expect(plain).toContain(t.code.shownCode("123456"));
    expect(html(render())).toContain('href="/v2/email?next=%2Fv2%2Fdeals%2F1"');
    expect(plain).toContain(t.code.changeEmail);
  });

  it("без кода от identity плашки нет", () => {
    expect(text(render({ demoCode: null }))).not.toContain(t.code.shownCode(""));
  });

  it("код уже был отправлен (перезагрузка, запрос раньше минуты) — пояснение плашкой", () => {
    expect(text(render({ notice: "alreadySent", demoCode: null }))).toContain(t.code.alreadySent);
    expect(text(render())).not.toContain(t.code.alreadySent);
    expect(text(render({ notice: "resent" }))).toContain(t.code.resent);
  });

  it("в доке одна кнопка «Подтвердить»; во время отсчёта повтор — строка текста, не кнопка", () => {
    const out = html(render());
    expect(count(out, "data-primary-action")).toBe(1);
    expect(count(out, "<button")).toBe(1);
    const dock = dockOf(out);
    expect(dock).toContain(t.code.submit);
    expect(dock).toContain('form="email-code"');
    // «Отправить ещё раз через 1:00» (или 0:59 — время идёт): строка без кнопки.
    expect(text(render())).toContain(t.code.resendIn(60).replace(/\s\S+$/, ""));
  });

  it("телефон: поле → повтор → «Изменить адрес» → док последним (у нижнего края)", () => {
    const out = html(render());
    expect(at(out, 'name="code"')).toBeLessThan(at(out, "data-resend-code"));
    expect(at(out, "data-resend-code")).toBeLessThan(at(out, t.code.changeEmail));
    expect(at(out, t.code.changeEmail)).toBeLessThan(at(out, "data-action-dock"));
  });

  it("компьютер: поле → «Подтвердить» → повтор под ней → «Изменить адрес»", () => {
    const out = html(render({}, "desktop"));
    expect(at(out, 'name="code"')).toBeLessThan(at(out, "data-action-dock"));
    expect(at(out, "data-action-dock")).toBeLessThan(at(out, "data-resend-code"));
    expect(at(out, "data-resend-code")).toBeLessThan(at(out, t.code.changeEmail));
  });

  it("неверный код — у поля, без второй плашки", () => {
    const wrong = ru.app.login.email.errors.wrongCode(4);
    h.form = { pending: false, error: wrong, fieldErrors: { code: wrong } };
    expect(count(text(render()), wrong)).toBe(1);
  });

  it("адрес почты — только в скрытом поле формы повтора, код вводится цифрами", () => {
    const out = html(render());
    expect(out).toMatch(/<input(?=[^>]*type="hidden")(?=[^>]*name="email")(?=[^>]*value="erlan@mail.kz")[^>]*>/);
    expect(out).toMatch(/<input(?=[^>]*name="code")(?=[^>]*autoComplete="one-time-code")[^>]*>/);
  });
});

describe("sentAfter: что показать после запроса кода", () => {
  const NOW = 1_000_000;
  const data = (over: Partial<{ email: string; demoCode: string | null; alreadySent: boolean }> = {}) => ({
    email: "erlan@mail.kz",
    demoCode: "123456",
    alreadySent: false,
    ...over,
  });

  it("код отправлен — без плашки, повтор через минуту", () => {
    expect(sentAfter(null, data(), false, NOW)).toEqual({ email: "erlan@mail.kz", demoCode: "123456", retryAt: NOW + 60_000, notice: "none" });
    expect(sentAfter(null, data(), true, NOW).notice).toBe("resent");
  });

  it("код уже был отправлен после перезагрузки — плашка «уже отправлен», кода на экране нет, полный интервал повтора", () => {
    expect(sentAfter(null, data({ demoCode: null, alreadySent: true }), false, NOW)).toEqual({
      email: "erlan@mail.kz",
      demoCode: null,
      retryAt: NOW + 60_000,
      notice: "alreadySent",
    });
  });

  it("тому же адресу в этой странице — прежний код заглушки остаётся на экране", () => {
    const previous = sentAfter(null, data(), false, NOW);
    expect(sentAfter(previous, data({ demoCode: null, alreadySent: true }), true, NOW + 5_000).demoCode).toBe("123456");
    expect(sentAfter(previous, data({ email: "other@mail.kz", demoCode: null, alreadySent: true }), false, NOW).demoCode).toBeNull();
  });
});
