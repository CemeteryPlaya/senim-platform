import { beforeEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { CONSENT_DOCUMENTS } from "@/i18n/ru/consent";
import { count, hasClass, html, text } from "@/kit/test-utils";
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
const { ConsentForm, isScrolledToEnd, refreshOnConflict } = await import("./ConsentForm");

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

describe("новая редакция текста", () => {
  it("согласие прошлой редакции — страница согласия с пометкой «текст обновился», текущая версия в форме, отметка снята", async () => {
    h.user = person({ consents: [{ ...CURRENT, version: "2026-11-01-d0" }] });
    const result = await open("/v2/deals/1");
    expect(result).toHaveProperty("page");
    const page = (result as { page: React.ReactElement<{ updated: boolean; document: { version: string } }> }).page;
    expect(page.props.updated).toBe(true);
    expect(page.props.document.version).toBe(doc.version);
    const out = html(page);
    expect(out).toContain(`name="version" value="${doc.version}"`);
    expect(out).toMatch(/<input[^>]*name="agreed"[^>]*>/);
    expect(out.match(/<input[^>]*name="agreed"[^>]*>/)?.[0]).not.toContain("checked");
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
    expect(text(render())).toContain(ru.app.onboarding.step(1, 3));
    expect(text(render({ step: 2, total: 3 }))).toContain(ru.app.onboarding.step(2, 3));
  });

  it("редакция показана датой, а в действие уходит прежняя версия; отметка — новая формулировка", () => {
    expect(t.edition("2026-11-11-d1")).toBe("Редакция от 11 ноября 2026");
    expect(t.edition("2026-01-05-d2")).toBe("Редакция от 5 января 2026");
    expect(t.edition("v7")).toBe("Редакция v7");
    expect(t.edition("2026-13-11-d1")).toBe("Редакция 2026-13-11-d1");
    expect(html(render())).toContain(`name="version" value="${doc.version}"`);
    expect(t.agree).toBe("С текстом ознакомлен(а), согласие на обработку моих данных даю");
  });

  it("счётчик анкеты с полосой; над заголовком строка той же высоты, что «Назад» на входе (36 px на компьютере)", () => {
    const out = html(render());
    expect(out).toContain('role="progressbar"');
    expect(out).toContain("desktop:min-h-control-sm");
    expect(text(render())).not.toContain("Шаг 1 из 3Согласие");
  });

  it("текст согласия показан целиком, как в документе: отметка черновика, редакция, все разделы", () => {
    const plain = text(render());
    expect(plain).toContain(doc.draft);
    expect(plain).toContain(t.edition(doc.version));
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

  it("в доке одна кнопка «Продолжить», связанная с формой; «Выйти» и «Назад» на шаге нет; «Зачем это нужно» — по нажатию", () => {
    const out = html(render());
    const dock = out.slice(out.indexOf("data-action-dock"));
    expect(dock).toContain('form="consent-form"');
    expect(dock).toContain(t.submit);
    expect(count(dock, "<button")).toBe(1);
    expect(text(render())).not.toContain(ru.app.shell.logout);
    expect(out).not.toContain(ru.app.kit.back);
    expect(text(render())).toContain(t.explain.label);
    expect(text(render())).not.toContain(t.explain.body);
  });

  it("новая редакция: «текст обновился»; в первый раз — только заголовок, без вступления (экономит первый экран телефона)", () => {
    expect(text(render({ updated: true }))).toContain(ru.consent.screen.updated);
    expect(text(render())).not.toContain(ru.consent.screen.updated);
    expect(text(render())).not.toContain(ru.consent.screen.lead);
  });

  it("область текста: до max-h-64 на телефоне и max-h-80 на компьютере, своя прокрутка", () => {
    const region = /<div[^>]*role="region"[^>]*>/.exec(html(render()))?.[0] ?? "";
    for (const cls of ["max-h-64", "overflow-y-auto", "desktop:max-h-80"]) expect(hasClass(region, cls), cls).toBe(true);
  });

  it("видно, что текст длиннее: обёртка с затуханием (scroll-fade, не дошли до конца) и подпись, которая держит место", () => {
    const out = html(render());
    expect(out).toMatch(/<div data-end="false" class="scroll-fade"/);
    expect(text(render())).toContain(t.scrollHint);
    // Подпись не пропадает из разметки (раскладка не прыгает) и для диктора не скрыта, пока текст не дочитан.
    expect(out).toMatch(new RegExp(`<p aria-hidden="false"[^>]*>${t.scrollHint}</p>`));
  });

  it("isScrolledToEnd: до конца прокручено (с допуском 2 px) или текст помещается целиком", () => {
    expect(isScrolledToEnd({ scrollTop: 0, clientHeight: 200, scrollHeight: 900 })).toBe(false);
    expect(isScrolledToEnd({ scrollTop: 697, clientHeight: 200, scrollHeight: 900 })).toBe(false);
    expect(isScrolledToEnd({ scrollTop: 698, clientHeight: 200, scrollHeight: 900 })).toBe(true);
    expect(isScrolledToEnd({ scrollTop: 700, clientHeight: 200, scrollHeight: 900 })).toBe(true);
    expect(isScrolledToEnd({ scrollTop: 0, clientHeight: 200, scrollHeight: 200 })).toBe(true);
  });

  it("«текст обновился» (CONFLICT): экран перечитывается; другие ответы — нет; ответ возвращается как есть", () => {
    const refresh = vi.fn();
    const conflict = { ok: false, code: "CONFLICT", error: ru.consent.errors.versionChanged } as const;
    expect(refreshOnConflict(conflict, refresh)).toBe(conflict);
    expect(refresh).toHaveBeenCalledTimes(1);
    for (const result of [
      { ok: true, data: undefined },
      { ok: false, code: "VALIDATION", error: "x" },
      { ok: false, code: "UNAUTHENTICATED", error: "x" },
    ] as const) {
      expect(refreshOnConflict(result, refresh)).toBe(result);
    }
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("форма пересоздаётся при новой редакции: отметка не переходит на текст, которого человек не видел", () => {
    // key формы — версия редакции: React при её смене создаёт форму заново, и отметка сбрасывается (e2e — задача D3).
    const a = html(render());
    const b = html(<ConsentForm document={{ ...doc, version: "2099-01-01-t1" }} updated next={null} step={1} total={3} device="mobile" />);
    expect(a).toContain(`name="version" value="${doc.version}"`);
    expect(b).toContain('name="version" value="2099-01-01-t1"');
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
