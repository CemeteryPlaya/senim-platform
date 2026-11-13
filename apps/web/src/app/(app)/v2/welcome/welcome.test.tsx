import { beforeEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { count, html, text } from "@/kit/test-utils";
import { consentDocument, consentTextSha256 } from "@/modules/identity";

const h = vi.hoisted(() => ({
  user: null as unknown,
  chosen: null as "CLIENT" | "EXECUTOR" | null,
  form: { pending: false, error: null as string | null, fieldErrors: {} as Record<string, string> },
}));

vi.mock("@/modules/identity", async (original) => ({
  ...(await original<typeof import("@/modules/identity")>()),
  getCurrentUser: async () => h.user,
}));
vi.mock("../../_shell/role-cookie", () => ({ recallRole: async () => h.chosen }));
vi.mock("@/platform/device", () => ({ getDevice: async () => "mobile" }));
vi.mock("../../_shell/form", () => ({ useActionForm: () => ({ ...h.form, onSubmit() {}, submit: async () => {} }) }));
vi.mock("../../_shell/session-actions", () => ({ logout: vi.fn() }));
vi.mock("./actions", () => ({ introduceAction: vi.fn() }));

const { default: WelcomePage } = await import("./page");
const { WelcomeForm } = await import("./WelcomeForm");

const t = ru.app.onboarding.welcome;
const CURRENT = { id: "c1", version: consentDocument("PD_PROCESSING").version, textSha256: consentTextSha256("PD_PROCESSING") };

/** Человек, прошедший согласие, но не знакомство; поля переопределяет тест. */
function person(over: Record<string, unknown> = {}) {
  return {
    id: "u1",
    role: "CLIENT",
    roles: ["CLIENT"],
    executor: null,
    fullName: null,
    iinLast4: null,
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

const open = (next?: string) => outcome(WelcomePage({ searchParams: Promise.resolve(next === undefined ? {} : { next }) }));
const h1 = (out: string) => out.match(/<h1[^>]*>([^<]*)<\/h1>/)?.[1];

beforeEach(() => {
  h.user = person();
  h.chosen = null;
  h.form = { pending: false, error: null, fieldErrors: {} };
});

describe("страница знакомства: куда ведёт", () => {
  it("гость — на вход с возвратом туда, куда шёл", async () => {
    h.user = null;
    expect(await open("/v2/deals/1")).toEqual({ redirect: "/v2/login?next=%2Fv2%2Fdeals%2F1" });
  });

  it("без согласия — сначала согласие с тем же возвратом (ФИО и ИИН собираются после согласия)", async () => {
    h.user = person({ consents: [] });
    expect(await open("/v2/deals/1")).toEqual({ redirect: "/v2/consent?next=%2Fv2%2Fdeals%2F1" });
  });

  it("пройденный шаг пропускается: почта не подтверждена — на почту", async () => {
    h.user = person({ fullName: "Сапаров Ерлан", iinLast4: "1234" });
    expect(await open("/v2/deals/1")).toEqual({ redirect: "/v2/email?next=%2Fv2%2Fdeals%2F1" });
  });

  it("все шаги пройдены — next, а без него дом", async () => {
    h.user = person({ fullName: "Сапаров Ерлан", iinLast4: "1234", emailVerified: true });
    expect(await open("/v2/deals/1")).toEqual({ redirect: "/v2/deals/1" });
    expect(await open()).toEqual({ redirect: "/v2" });
  });

  it("нужное знакомство — страница с формой, без перехода (петли нет)", async () => {
    expect(await open()).toHaveProperty("page");
    expect(await open("/v2/deals/1")).toHaveProperty("page");
  });
});

describe("экран знакомства", () => {
  const render = (over: Partial<Parameters<typeof WelcomeForm>[0]> = {}) => (
    <WelcomeForm defaultFullName={null} next={null} step={2} total={3} device="mobile" {...over} />
  );

  it("один заголовок, одно главное действие, «Шаг N из M» по оставшемуся", () => {
    const out = html(render());
    expect(count(out, "<h1")).toBe(1);
    expect(h1(out)).toBe(t.title);
    expect(count(out, "data-primary-action")).toBe(1);
    expect(text(render())).toContain(ru.app.kit.wizard.step(2, 3));
  });

  it("два поля с подписями; ИИН — цифровая клавиатура без автозаполнения; форма отправляется POST", () => {
    const out = html(render());
    expect(text(render())).toContain(t.fullName);
    expect(text(render())).toContain(t.iin);
    expect(out).toMatch(/<input[^>]*name="fullName"[^>]*>/);
    expect(out).toMatch(/<input[^>]*name="iin"[^>]*>/);
    expect(out).toMatch(/<input(?=[^>]*name="iin")(?=[^>]*inputMode="numeric")(?=[^>]*autoComplete="off")[^>]*>/);
    expect(out).toMatch(/<form[^>]*method="post"/);
  });

  it("ФИО из проекции подставляется, ИИН поле пустое", () => {
    const out = html(render({ defaultFullName: "Сапаров Ерлан" }));
    expect(out).toMatch(/<input(?=[^>]*name="fullName")(?=[^>]*value="Сапаров Ерлан")[^>]*>/);
    expect(out).not.toMatch(/<input(?=[^>]*name="iin")(?=[^>]*value=)[^>]*>/);
  });

  it("под полями нет постоянных подсказок; «Зачем ИИН» — по нажатию", () => {
    const plain = text(render());
    expect(plain).toContain(t.explain.label);
    expect(plain).not.toContain(t.explain.body);
  });

  it("ошибки identity у полей: формат ИИН и ФИО; общей плашки поверх них нет", () => {
    const iin = ru.identity.clientIdentity.iinInvalid;
    const name = ru.identity.clientIdentity.fullNameInvalid;
    h.form = { pending: false, error: iin, fieldErrors: { iin, fullName: name } };
    const out = html(render());
    expect(count(text(render()), iin)).toBe(1);
    expect(count(text(render()), name)).toBe(1);
    expect(count(out, 'aria-invalid="true"')).toBe(2);
  });

  it("отказ без поля (ИИН уже указан в другом аккаунте) — общей плашкой", () => {
    h.form = { pending: false, error: ru.identity.clientIdentity.iinTaken, fieldErrors: {} };
    expect(html(render())).toContain('role="alert"');
    expect(text(render())).toContain(ru.identity.clientIdentity.iinTaken);
  });

  it("в доке одна кнопка «Продолжить», связанная с формой; «Выйти» и «Назад» на шаге нет", () => {
    const out = html(render());
    const dock = out.slice(out.indexOf("data-action-dock"));
    expect(dock).toContain('form="welcome-form"');
    expect(dock).toContain(t.submit);
    expect(count(dock, "<button")).toBe(1);
    expect(text(render())).not.toContain(ru.app.shell.logout);
    expect(out).not.toContain(ru.app.kit.back);
  });
});
