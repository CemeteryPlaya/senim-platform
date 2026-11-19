import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { testBin, testIin } from "@/seed/kz-id";
import { ru } from "@/i18n/ru";
import { count, hasClass, html } from "@/kit/test-utils";
import { consentDocument, consentTextSha256 } from "@/modules/identity";
import { AppError } from "@/platform/errors";

const h = vi.hoisted(() => ({
  user: null as unknown,
  registration: null as unknown,
  unavailable: false,
  kyc: "NOT_SUBMITTED" as string | Error,
  deals: [] as { myRole: string }[],
  form: { pending: false, error: null as string | null, fieldErrors: {} as Record<string, string> },
}));

vi.mock("@/modules/identity", async (original) => ({
  ...(await original<typeof import("@/modules/identity")>()),
  getCurrentUser: async () => {
    if (h.unavailable) throw new AppError("UNAVAILABLE", ru.common.errors.generic);
    return h.user;
  },
  getShellUser: async () => ({ user: h.unavailable ? null : h.user, unavailable: h.unavailable }),
  getMyRegistration: async () => h.registration,
  getOwnKyc: async () => {
    if (h.kyc instanceof Error) throw h.kyc;
    return { state: h.kyc, canSubmit: true, rejectReason: null, documents: { id: 0, registration: 0 } };
  },
}));
vi.mock("@/modules/deal-core", async (original) => ({
  ...(await original<typeof import("@/modules/deal-core")>()),
  listDeals: async () => h.deals,
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} }),
}));
vi.mock("../../../_shell/role-cookie", () => ({ recallRole: async () => null }));
vi.mock("@/platform/device", () => ({ getDevice: async () => "mobile" }));
vi.mock("../../../_shell/form", () => ({ useActionForm: () => ({ ...h.form, onSubmit() {}, submit: async () => {} }) }));
vi.mock("./actions", () => ({ registerMasterAction: vi.fn(), forgetMasterChoiceAction: vi.fn() }));

const { default: RegisterPage } = await import("./page");
const { CheckSummary, NameFields } = await import("./RegisterSteps");
const { initialAnswers } = await import("./_parts/steps");

const t = ru.app.masterRegister;
const CURRENT = { id: "c1", version: consentDocument("PD_PROCESSING").version, textSha256: consentTextSha256("PD_PROCESSING") };
const BIN = testBin("2101", 16);
const DIRECTOR_IIN = testIin("800215", 3, 41);

/** Заказчик с пройденными первыми шагами; поля переопределяет тест. */
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

const registration = (status: "PENDING" | "APPROVED" | "REJECTED", over: Record<string, unknown> = {}) => ({
  status,
  legalForm: "TOO",
  legalName: "ТОО «Ағаш»",
  binIinLast4: BIN.slice(-4),
  rejectReason: null,
  ...over,
});

async function open(step?: string): Promise<{ redirect: string } | { out: string }> {
  try {
    const page = (await RegisterPage({ searchParams: Promise.resolve(step === undefined ? {} : { step }) })) as ReactElement;
    return { out: html(page) };
  } catch (e) {
    const digest = (e as { digest?: string }).digest ?? "";
    if (!digest.startsWith("NEXT_REDIRECT")) throw e;
    return { redirect: digest.split(";")[2] ?? "" };
  }
}

async function page(step?: string): Promise<string> {
  const res = await open(step);
  if (!("out" in res)) throw new Error(`ожидался экран, а не переход на ${res.redirect}`);
  return res.out;
}

/** Кнопка «Сначала заказать мебель» целиком (тег с подписью) или `null`. */
const orderFirstButton = (out: string): string | null =>
  out.match(new RegExp(`<button[^>]*>(?:(?!</button>).)*${t.orderFirst}(?:(?!</button>).)*</button>`))?.[0] ?? null;

const h1 = (out: string) => out.match(/<h1[^>]*>([^<]*)<\/h1>/)?.[1];
/** Экран по правилам: один h1, не больше одного главного действия; ни одного полного ИИН/БИН (12 цифр подряд). */
function expectScreen(out: string) {
  expect(count(out, "<h1")).toBe(1);
  expect(count(out, "data-primary-action")).toBeLessThanOrEqual(1);
  expect(out).not.toMatch(/\d{12}/);
  expect(out).not.toContain(BIN);
}

beforeEach(() => {
  h.user = person();
  h.registration = null;
  h.unavailable = false;
  h.kyc = "NOT_SUBMITTED";
  h.deals = [];
  h.form = { pending: false, error: null, fieldErrors: {} };
});

describe("регистрация мастера: кто что видит", () => {
  it("гость — что нужно и вход мастером с возвратом сюда", async () => {
    h.user = null;
    const out = await page();
    expectScreen(out);
    expect(h1(out)).toBe(t.guest.title);
    for (const step of t.guest.steps) expect(out).toContain(step);
    expect(out).toContain('href="/v2/login?role=executor&amp;next=%2Fv2%2Fregister%2Fexecutor"');
    expect(count(out, "data-primary-action")).toBe(1);
  });

  it("не пройдено знакомство — сначала оно с возвратом сюда", async () => {
    h.user = person({ fullName: null, iinLast4: null });
    expect(await open()).toEqual({ redirect: "/v2/welcome?next=%2Fv2%2Fregister%2Fexecutor" });
  });

  it("оператор — в свой дом", async () => {
    h.user = person({ role: "OPERATOR", roles: ["OPERATOR"] });
    expect(await open()).toEqual({ redirect: "/v2/operator" });
  });

  it("нет профиля — анкета с первого шага: «Назад» на главную, пояснение для покупателя, «Дальше»", async () => {
    const out = await page();
    expectScreen(out);
    expect(h1(out)).toBe(t.steps.form);
    expect(out).toContain(ru.app.kit.wizard.step(1, 4));
    expect(out).toContain(t.backHome);
    expect(out).toContain(t.form.keepsBuyer);
    for (const form of Object.values(t.form.legalForms)) expect(out).toContain(form);
    expect(out).toContain(t.next);
  });

  it("мастер без профиля пояснения «станете мастером» не видит", async () => {
    h.user = person({ role: "EXECUTOR", roles: ["EXECUTOR"] });
    expect(await page()).not.toContain(t.form.keepsBuyer);
  });

  it("покупатель на первом шаге — выход «Сначала заказать мебель»: тихая кнопка 48 px, не главное действие", async () => {
    const out = await page();
    const exit = orderFirstButton(out);
    expect(exit).not.toBeNull();
    expect(hasClass(exit!, "min-h-control")).toBe(true);
    expect(exit).not.toContain("data-primary-action");
    expect(count(out, "data-primary-action")).toBe(1);
  });

  it("выхода «Сначала заказать мебель» нет: дальше первого шага, у мастера, после отказа", async () => {
    expect(await page("place")).not.toContain(t.orderFirst);
    h.user = person({ role: "EXECUTOR", roles: ["EXECUTOR"] });
    expect(await page()).not.toContain(t.orderFirst);
    h.user = person();
    h.registration = registration("REJECTED");
    expect(await page("form")).not.toContain(t.orderFirst);
  });

  it("шаг из адреса открывается (дальше — после восстановления в браузере)", async () => {
    const out = await page("place");
    expect(h1(out)).toBe(t.steps.place);
    expect(out).toContain(`href="/v2/register/executor?step=name"`);
  });

  it("на проверке, документы не поданы: главное действие «Загрузить документы», счёт и портфолио — строками; БИН — 4 цифры", async () => {
    h.user = person({ role: "EXECUTOR", roles: ["CLIENT", "EXECUTOR"], executor: { id: "e1", status: "PENDING" } });
    h.registration = registration("PENDING");
    const out = await page();
    expectScreen(out);
    expect(h1(out)).toBe(t.status.title);
    expect(out).toContain(t.status.pending.now);
    for (const item of t.status.pending.checks) expect(out).toContain(item);
    expect(count(out, "data-primary-action")).toBe(1);
    expect(out.slice(out.indexOf("data-action-dock"))).toContain('href="/v2/executor/profile/kyc"');
    expect(out.slice(out.indexOf("data-action-dock"))).toContain(t.status.pending.documents);
    expect(out).toContain('href="/v2/executor/profile/payout"');
    expect(out).toContain('href="/v2/executor/portfolio"');
    expect(out).toContain(`${t.status.bin}`);
    expect(out).toContain(`•••• ${BIN.slice(-4)}`);
    // Пояснение «как проходит проверка» не повторяет первую карточку.
    expect(out).not.toContain(t.form.explain.label);
  });

  it("«Ваши сделки» — только у мастера, у которого сделки есть; без сделок и у заказчика ссылки нет", async () => {
    h.user = person({ role: "EXECUTOR", roles: ["CLIENT", "EXECUTOR"], executor: { id: "e1", status: "PENDING" } });
    h.registration = registration("PENDING");
    expect(await page()).not.toContain(ru.app.masterDeal.list.yours);
    h.deals = [{ myRole: "EXECUTOR" }];
    const out = await page();
    expect(out).toMatch(new RegExp(`<a [^>]*href="/v2/deals"[^>]*>${ru.app.masterDeal.list.yours}`));
    expect(count(out, "data-primary-action")).toBe(1);
    h.registration = registration("REJECTED");
    expect(await page()).toContain(ru.app.masterDeal.list.yours);
    h.user = person({ roles: ["CLIENT", "EXECUTOR"], executor: { id: "e1", status: "PENDING" } });
    expect(await page()).not.toContain(ru.app.masterDeal.list.yours);
  });

  it("документы отклонены — то же главное действие", async () => {
    h.registration = registration("PENDING");
    h.kyc = "REJECTED";
    expect(count(await page(), "data-primary-action")).toBe(1);
  });

  it.each(["PENDING", "VERIFIED"] as const)("документы %s — главного действия нет, строка с их состоянием", async (state) => {
    h.registration = registration("PENDING");
    h.kyc = state;
    const out = await page();
    expect(count(out, "data-primary-action")).toBe(0);
    expect(out).toContain(t.status.pending.documentsState[state]);
    expect(out).toContain('href="/v2/executor/profile/kyc"');
  });

  it("состояние документов не узнать — без главного действия, ссылка на документы", async () => {
    h.registration = registration("PENDING");
    h.kyc = new AppError("UNAVAILABLE", ru.common.errors.generic);
    const out = await page();
    expect(count(out, "data-primary-action")).toBe(0);
    expect(out).toContain(t.status.pending.documents);
  });

  it("подпись номера по форме работы: у ТОО — БИН, у ИП — ИИН", async () => {
    h.registration = registration("APPROVED", { legalForm: "IP", legalName: "ИП «Дала»" });
    const out = await page();
    expect(out).toContain(`>${t.status.iin}<`);
    expect(out).not.toContain(`>${t.status.bin}<`);
  });

  it("вошедший при недоступном identity — не экран гостя, а ошибка (граница ошибок оболочки)", async () => {
    h.unavailable = true;
    await expect(RegisterPage({ searchParams: Promise.resolve({}) })).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });

  it("на проверке адрес шага анкету не открывает", async () => {
    h.registration = registration("PENDING");
    expect(h1(await page("form"))).toBe(t.status.title);
  });

  it("одобрено — «Перейти к заявкам»", async () => {
    h.registration = registration("APPROVED");
    const out = await page();
    expectScreen(out);
    expect(out).toContain(t.status.approved.now);
    expect(out).toMatch(/<a [^>]*href="\/v2\/executor\/requests"[^>]*data-primary-action|<a [^>]*data-primary-action[^>]*href="\/v2\/executor\/requests"/);
  });

  it("отказ — причина и «Исправить и отправить заново» на первый шаг; с шагом — анкета с прежними данными и «Назад» к статусу", async () => {
    h.registration = registration("REJECTED", { rejectReason: "Наименование не совпадает с документами" });
    const out = await page();
    expectScreen(out);
    expect(out).toContain(t.status.rejected.reason("Наименование не совпадает с документами"));
    expect(out).toContain(t.status.rejected.action);
    expect(out).toContain('href="/v2/register/executor?step=form"');

    const again = await page("form");
    expect(h1(again)).toBe(t.steps.form);
    expect(again).toContain(t.backStatus);
    // Причина отказа — плашкой на шаге анкеты.
    expect(again).toContain(t.status.rejected.againTitle);
    expect(again).toContain(t.status.rejected.reason("Наименование не совпадает с документами"));
    // Прежняя форма работы выбрана.
    expect(again).toMatch(/value="TOO"[^>]*checked|checked[^>]*value="TOO"/);
  });

  it("отказ без причины — пояснение, что делать", async () => {
    h.registration = registration("REJECTED");
    expect(await page()).toContain(t.status.rejected.noReason);
  });
});

describe("шаги анкеты: номера и ошибки", () => {
  const too = { ...initialAnswers(), legalForm: "TOO" as const, legalName: "ТОО «Ағаш»", binIin: BIN, directorName: "Тулегенов Бауыржан", directorIin: DIRECTOR_IIN, yearsExperience: "7" };

  it("сводка ТОО: БИН и ИИН директора — только 4 цифры", () => {
    const out = html(<CheckSummary answers={too} ownIinLast4="1234" />);
    expect(out).not.toContain(BIN);
    expect(out).not.toContain(DIRECTOR_IIN);
    expect(out).toContain(`•••• ${BIN.slice(-4)}`);
    expect(out).toContain(`•••• ${DIRECTOR_IIN.slice(-4)}`);
    expect(out).toContain('href="/v2/register/executor?step=name"');
  });

  it("ИП: ИИН из знакомства — 4 цифры, поля ввода номера нет; отказ по номеру — плашкой", () => {
    const ip = { ...initialAnswers(), legalForm: "IP" as const };
    const out = html(<NameFields answers={ip} errors={{ binIin: t.errors.ownIinInvalid }} onChange={() => {}} ownIinLast4="1234" />);
    expect(out).toContain("•••• 1234");
    expect(out).not.toContain('name="binIin"');
    expect(out).toContain('name="ownerName"');
    expect(out).toContain(t.errors.ownIinInvalid);
  });

  it("ТОО: БИН, директор и его ИИН; ошибки — у полей", () => {
    const out = html(<NameFields answers={{ ...too, binIin: "" }} errors={{ binIin: t.errors.binRequired }} onChange={() => {}} ownIinLast4="1234" />);
    for (const name of ["legalName", "binIin", "directorName", "directorIin"]) expect(out).toContain(`name="${name}"`);
    expect(out).not.toContain("•••• 1234");
    expect(out).toMatch(/data-field="binIin"[^>]*aria-invalid="true"|aria-invalid="true"[^>]*data-field="binIin"/);
    expect(out).toContain(t.errors.binRequired);
  });
});
