import { beforeEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { CONSENT_DOCUMENTS } from "@/i18n/ru/consent";
import { count, html, text } from "@/kit/test-utils";
import { consentTextSha256 } from "@/modules/identity";

const h = vi.hoisted(() => ({
  user: null as unknown,
  chosen: null as "CLIENT" | "EXECUTOR" | null,
  device: "mobile" as "mobile" | "desktop",
  form: { pending: false, error: null as string | null, fieldErrors: {} as Record<string, string> },
}));

vi.mock("@/modules/identity", async (original) => ({
  ...(await original<typeof import("@/modules/identity")>()),
  getCurrentUser: async () => h.user,
}));
vi.mock("../../_shell/role-cookie", () => ({ recallRole: async () => h.chosen }));
vi.mock("@/platform/device", () => ({ getDevice: async () => h.device }));
vi.mock("next/navigation", async (original) => ({ ...(await original<typeof import("next/navigation")>()), useRouter: () => ({ refresh() {} }) }));
vi.mock("../../_shell/form", () => ({ useActionForm: () => ({ ...h.form, onSubmit() {}, submit: async () => {} }) }));
vi.mock("../../_shell/session-actions", () => ({ logout: vi.fn() }));
vi.mock("./actions", () => ({ grantConsentAction: vi.fn() }));

const { default: ConsentPage } = await import("./page");
const { ConsentForm } = await import("./ConsentForm");

const t = ru.app.onboarding.consent;
const doc = CONSENT_DOCUMENTS.PD_PROCESSING;
const CURRENT = { id: "c1", version: doc.version, textSha256: consentTextSha256("PD_PROCESSING") };

/** Человек, прошедший все первые шаги; поля переопределяет тест. */
function person(over: Record<string, unknown> = {}) {
  return {
    id: "u1",
    role: "CLIENT",
    roles: ["CLIENT"],
    executor: null,
    fullName: "Сапаров Ерлан",
    iinLast4: "1234",
    emailVerified: true,
    mfa: { required: false, verifiedAt: null },
    consents: [CURRENT],
    consentRevocationOpen: false,
    ...over,
  };
}

/** Итог страницы: адрес redirect() (Next бросает ошибку с digest) или готовая страница. */
async function outcome(p: Promise<unknown>): Promise<{ redirect: string } | { page: unknown }> {
  try {
    return { page: await p };
  } catch (e) {
    const digest = (e as { digest?: string }).digest ?? "";
    if (!digest.startsWith("NEXT_REDIRECT")) throw e;
    return { redirect: digest.split(";")[2] ?? "" };
  }
}

const open = (next?: string) => outcome(ConsentPage({ searchParams: Promise.resolve(next === undefined ? {} : { next }) }));
const h1 = (out: string) => out.match(/<h1[^>]*>([^<]*)<\/h1>/)?.[1];

beforeEach(() => {
  h.user = person({ consents: [], fullName: null, iinLast4: null, emailVerified: false });
  h.chosen = null;
  h.device = "mobile";
  h.form = { pending: false, error: null, fieldErrors: {} };
});

describe("страница согласия: куда ведёт", () => {
  it("гость — на вход с возвратом туда, куда шёл", async () => {
    h.user = null;
    expect(await open("/v2/deals/1")).toEqual({ redirect: "/v2/login?next=%2Fv2%2Fdeals%2F1" });
    expect(await open()).toEqual({ redirect: "/v2/login" });
  });

  it("пройденный шаг пропускается: дальше — следующий шаг с тем же next", async () => {
    h.user = person({ fullName: null, iinLast4: null });
    expect(await open("/v2/deals/1")).toEqual({ redirect: "/v2/welcome?next=%2Fv2%2Fdeals%2F1" });
  });

  it("все шаги пройдены — next, а без него дом", async () => {
    h.user = person();
    expect(await open("/v2/deals/1")).toEqual({ redirect: "/v2/deals/1" });
    expect(await open()).toEqual({ redirect: "/v2" });
  });

  it("выбравший «Я мастер» после шагов попадает на регистрацию мастера", async () => {
    h.user = person();
    h.chosen = "EXECUTOR";
    expect(await open()).toEqual({ redirect: "/v2/register/executor" });
  });

  it("чужой next отбрасывается", async () => {
    h.user = person();
    expect(await open("https://evil.example/x")).toEqual({ redirect: "/v2" });
  });

  it("оператора согласие не касается — его раздел", async () => {
    h.user = person({ role: "OPERATOR", roles: ["OPERATOR"], consents: [], mfa: { required: true, verifiedAt: new Date() } });
    expect(await open()).toEqual({ redirect: "/v2/operator" });
  });

  it("нужное согласие — страница с формой, без перехода (петли нет)", async () => {
    expect(await open()).toHaveProperty("page");
    expect(await open("/v2/deals/1")).toHaveProperty("page");
  });
});

describe("экран согласия", () => {
  const render = (over: Partial<Parameters<typeof ConsentForm>[0]> = {}) => (
    <ConsentForm document={doc} updated={false} next={null} step={1} total={3} device="mobile" {...over} />
  );

  it("один заголовок, одно главное действие, честный «Шаг N из M»", () => {
    const out = html(render());
    expect(count(out, "<h1")).toBe(1);
    expect(h1(out)).toBe(t.title);
    expect(count(out, "data-primary-action")).toBe(1);
    expect(text(render())).toContain(ru.app.kit.wizard.step(1, 3));
    expect(text(render({ step: 1, total: 1 }))).toContain(ru.app.kit.wizard.step(1, 1));
  });

  it("текст согласия показан целиком, как в документе: отметка черновика, редакция, все разделы", () => {
    const plain = text(render());
    expect(plain).toContain(doc.draft);
    expect(plain).toContain(ru.consent.screen.edition(doc.version));
    for (const section of doc.sections) {
      expect(plain).toContain(section.heading);
      expect(plain).toContain(section.body);
    }
  });

  it("текст — прокручиваемая область с именем, доступная с клавиатуры", () => {
    expect(html(render())).toMatch(new RegExp(`<div role="region" aria-label="${t.textLabel}" tabindex="0"[^>]*overflow-y-auto`));
  });

  it("отметка — поле agreed со значением on; редакция и возврат — скрытые поля", () => {
    const out = html(render({ next: "/v2/deals/1" }));
    expect(out).toMatch(/<input[^>]*type="checkbox"[^>]*>/);
    expect(out).toMatch(/<input[^>]*name="agreed"[^>]*>/);
    expect(out).toMatch(/<input[^>]*value="on"[^>]*>/);
    expect(text(render())).toContain(t.agree);
    expect(out).toContain(`name="version" value="${doc.version}"`);
    expect(out).toContain('name="next" value="/v2/deals/1"');
  });

  it("форма без JavaScript отправляется методом POST, а не GET", () => {
    expect(html(render())).toMatch(/<form[^>]*method="post"/);
  });

  it("в доке «Продолжить» связана с формой, рядом тихая «Выйти»; «Зачем это нужно» — по нажатию", () => {
    const out = html(render());
    const dock = out.slice(out.indexOf("data-action-dock"));
    expect(dock).toContain('form="consent-form"');
    expect(dock).toContain(t.submit);
    expect(dock).toContain(ru.app.shell.logout);
    expect(text(render())).toContain(t.explain.label);
    expect(text(render())).not.toContain(t.explain.body);
  });

  it("новая редакция: «текст обновился» вместо первого обращения", () => {
    expect(text(render({ updated: true }))).toContain(ru.consent.screen.updated);
    expect(text(render())).toContain(ru.consent.screen.lead);
  });

  it("«текст обновился» — общей плашкой; нет отметки — у поля, без второй плашки", () => {
    h.form = { pending: false, error: ru.consent.errors.versionChanged, fieldErrors: {} };
    expect(html(render())).toContain('role="alert"');
    expect(text(render())).toContain(ru.consent.errors.versionChanged);

    h.form = { pending: false, error: t.errors.required, fieldErrors: { agreed: t.errors.required } };
    expect(count(text(render()), t.errors.required)).toBe(1);
    expect(html(render())).toContain('aria-invalid="true"');
  });

  it("на компьютере колонка по центру", () => {
    expect(html(render({ device: "desktop" }))).toContain("desktop:max-w-narrow");
  });
});
