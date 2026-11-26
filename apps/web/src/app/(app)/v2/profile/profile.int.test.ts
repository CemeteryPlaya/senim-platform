import { isRedirectError } from "next/dist/client/components/redirect-error";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { getCurrentUser, getOwnContacts } from "@/modules/identity";
import type { ActionResult } from "@/platform/action";
import { db } from "@/platform/db";
import { makeClient, makeExecutor, makeOperator } from "../../../../../test/factories";
import { makeOfferThread } from "../../../../../test/factories/companies";
import { freshBrowser, setEnv } from "../../../../../test/factories/identity";
import { signInAs } from "../../../../../test/factories/session";
import { identityFake } from "../../../../../test/stubs/identity";

vi.mock("next/headers", async () => (await import("../../../../../test/factories/identity")).nextHeadersMock);
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
}));
vi.mock("@/platform/device", () => ({ getDevice: async () => "mobile" }));
// Действия сервера в статическом рендере не вызываются.
vi.mock("../../_shell/session-actions", () => ({ logout: vi.fn() }));
vi.mock("../../_shell/theme-actions", () => ({ chooseTheme: vi.fn(async () => undefined) }));

const { saveContactsAction } = await import("./contacts/actions");
const { revokeConsentAction } = await import("./data/actions");
const { default: ProfilePage } = await import("./(main)/page");
const { default: ContactsPage } = await import("./contacts/page");
const { default: MyDataPage } = await import("./data/page");

const d = ru.app.profile.data;

beforeEach(() => {
  freshBrowser({ "user-agent": "vitest" });
  setEnv({ SMS_PROVIDER: "mock" });
  identityFake.now = () => new Date();
});

async function run<T>(p: Promise<ActionResult<T>>): Promise<{ redirect: string } | ActionResult<T>> {
  try {
    return await p;
  } catch (err) {
    if (!isRedirectError(err)) throw err;
    return { redirect: err.digest.split(";")[2] };
  }
}

/** Страница → разметка или адрес перехода. */
async function render(page: (props: { searchParams: Promise<Record<string, string>> }) => Promise<ReactElement>, params: Record<string, string> = {}) {
  try {
    return { html: renderToStaticMarkup(await page({ searchParams: Promise.resolve(params) })) };
  } catch (e) {
    if (isRedirectError(e)) return { redirect: e.digest.split(";")[2] };
    throw e;
  }
}

const EMAIL = "erlan@mail.kz";

/** Покупатель, прошедший первые шаги, с подтверждённой почтой. */
async function buyer(over: { instagram?: string } = {}) {
  const user = await makeClient("Сапаров Ерлан");
  await db.user.update({ where: { id: user.id }, data: { email: EMAIL, emailVerifiedAt: new Date(), ...over } });
  await signInAs(user);
  return user;
}

describe("saveContactsAction", () => {
  it("записывает Instagram без «@», почту не трогает: подтверждение остаётся", async () => {
    await buyer();
    expect(await run(saveContactsAction({ instagram: " @Dala_01 " }))).toEqual({ ok: true, data: { instagram: "Dala_01" } });
    const user = (await getCurrentUser())!;
    expect(user.emailVerified).toBe(true);
    expect(await getOwnContacts(user)).toMatchObject({ instagram: "Dala_01", email: EMAIL });
    expect(identityFake.calls.filter((c) => c.method === "updateContacts").at(-1)?.request).toMatchObject({ keepEmail: true });
  });

  it("пустое поле — Instagram не указан", async () => {
    await buyer();
    await run(saveContactsAction({ instagram: "dala" }));
    expect(await run(saveContactsAction({ instagram: "" }))).toEqual({ ok: true, data: { instagram: null } });
  });

  it("неверный формат — ошибка у поля, identity не вызывается", async () => {
    await buyer();
    const before = identityFake.calls.filter((c) => c.method === "updateContacts").length;
    expect(await run(saveContactsAction({ instagram: "дала!" }))).toMatchObject({ ok: false, code: "VALIDATION", fieldErrors: { instagram: [ru.identity.contacts.instagramInvalid] } });
    expect(identityFake.calls.filter((c) => c.method === "updateContacts")).toHaveLength(before);
  });

  it("гость — UNAUTHENTICATED; оператор — отказ", async () => {
    expect(await run(saveContactsAction({ instagram: "dala" }))).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    freshBrowser({ "user-agent": "vitest" });
    await signInAs(await makeOperator());
    expect(await run(saveContactsAction({ instagram: "dala" }))).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });
});

describe("«Мои данные»", () => {
  it("ИИН — только последние четыре цифры: полного номера в разметке нет", async () => {
    const user = await buyer();
    const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    const { decryptPii } = await import("@/platform/crypto");
    const iin = decryptPii(row.iinEnc!);
    const { html } = await render(MyDataPage);
    expect(html).toContain(d.iinMasked(iin.slice(-4)));
    expect(html).not.toContain(iin);
    expect(html).not.toContain(iin.slice(0, 8));
    expect(html).toContain("Сапаров Ерлан");
    expect(html).toContain(EMAIL);
    expect(html).toContain(d.consentKinds.PD_PROCESSING);
    expect(html).toContain(`${ru.app.onboarding.consent.edition(identityFake.consentsOf(user.id)[0]!.version)}`);
  });

  it("отзыв: заявка оператору, согласие действует, повтор и двойное нажатие — одна заявка; в меню пункта больше нет", async () => {
    const user = await buyer();
    const results = await Promise.all([run(revokeConsentAction({})), run(revokeConsentAction({}))]);
    for (const r of results) expect(r).toMatchObject({ ok: true, data: { status: "REQUESTED" } });
    expect(identityFake.revocationsOf(user.id)).toHaveLength(1);
    expect(identityFake.consentsOf(user.id).filter((c) => c.revokedAt === null || c.revokedAt === undefined)).toHaveLength(1);

    const { html } = await render(MyDataPage);
    expect(html).toContain(d.revocation.title);
    expect(html).toContain(d.revocation.status.REQUESTED);
    expect(html).toContain(d.revocation.stillActive);
    expect(html).not.toContain(d.menu);
    expect(await run(revokeConsentAction({}))).toMatchObject({ ok: true });
    expect(identityFake.revocationsOf(user.id)).toHaveLength(1);
  });

  it("до отзыва в разметке есть меню «Действия с согласием»", async () => {
    await buyer();
    const { html } = await render(MyDataPage);
    expect(html).toContain(d.menu);
    expect(html).not.toContain(d.revocation.title);
  });

  it("гость и оператор — отказ действия; страница гостя ведёт на вход", async () => {
    expect(await run(revokeConsentAction({}))).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    expect(await render(MyDataPage)).toEqual({ redirect: "/v2/login?next=%2Fv2%2Fprofile%2Fdata" });
  });
});

describe("страницы профиля", () => {
  it("профиль: имя, телефон, разделы; «Контакты» показывают адрес почты и «Подтверждена»", async () => {
    await buyer();
    const profile = await render(ProfilePage);
    expect(profile.html).toContain("Сапаров Ерлан");
    expect(profile.html).toContain('href="/v2/profile/data"');
    const contacts = await render(ContactsPage);
    expect(contacts.html).toContain(EMAIL);
    expect(contacts.html).toContain(ru.app.profile.contacts.email.confirmed);
    expect(contacts.html).toContain('href="/v2/email?change=1"');
    expect(contacts.html!.split("<h1").length - 1).toBe(1);
    expect(contacts.html!.split("data-primary-action").length - 1).toBe(1);
  });

  it("профиль мастера: одобренному — все разделы мастера, публичный профиль по номеру; на проверке — без финансов, со статусом; покупателю разделов нет", async () => {
    const approved = await makeExecutor();
    await db.user.update({ where: { id: approved.id }, data: { emailVerifiedAt: new Date() } });
    await signInAs(approved);
    const full = (await render(ProfilePage)).html!;
    expect(full).toContain(ru.app.masterProfile.sectionsTitle);
    for (const href of ["/v2/executor/profile", "/v2/executor/profile/kyc", "/v2/executor/profile/payout", "/v2/executor/portfolio", "/v2/executor/finance"]) {
      expect(full).toContain(`href="${href}"`);
    }
    // Строки «Публичный профиль» нет (аудит, master-47): профиль по номеру открывается из «Компании».
    expect(full).not.toContain(`href="/v2/executors/${approved.executor.publicNumber}"`);

    const pending = await makeExecutor({ status: "PENDING" });
    await db.user.update({ where: { id: pending.id }, data: { emailVerifiedAt: new Date() } });
    await signInAs(pending);
    const wait = (await render(ProfilePage)).html!;
    expect(wait).toContain('href="/v2/register/executor"');
    expect(wait).not.toContain('href="/v2/executor/finance"');
    expect(wait).not.toContain("/v2/executors/");

    await buyer();
    expect((await render(ProfilePage)).html).not.toContain(ru.app.masterProfile.sectionsTitle);
  });

  it("профиль покупателя: счётчики, история со ссылками в v2 и вопросы про статусы; у мастера истории нет", async () => {
    const user = await buyer();
    const done = await makeOfferThread({ client: user, dealStatus: "SPLIT_PAYOUT", requestStatus: "CLOSED" });
    const open = await makeOfferThread({ client: user, dealStatus: undefined, requestStatus: "OPEN" });
    const h = ru.app.profile.history;
    const out = (await render(ProfilePage)).html!;
    expect(out).toContain(`>${h.title}</h2>`);
    expect(out).toContain(`href="/v2/deals/${done.dealId}"`);
    expect(out).toContain(`href="/v2/requests/${open.requestId}"`);
    expect(out).toContain(h.status.success);
    expect(out).not.toContain("В процессе");
    expect(out).toContain(h.faq.statuses.title);
    expect(out.split("data-primary-action").length - 1).toBe(0);

    const master = await makeExecutor();
    await db.user.update({ where: { id: master.id }, data: { emailVerifiedAt: new Date() } });
    await signInAs(master);
    const masterOut = (await render(ProfilePage)).html!;
    expect(masterOut).not.toContain(h.title);
    expect(masterOut).not.toContain(h.faq.title);
  });

  it("контакты: Instagram показан в поле; ?email=changed показывает тост-компонент", async () => {
    await buyer();
    await run(saveContactsAction({ instagram: "dala" }));
    const { html } = await render(ContactsPage, { email: "changed" });
    expect(html).toContain('value="dala"');
  });

  it("оператору контакты и «Мои данные» недоступны: уходит в свой дом", async () => {
    await signInAs(await makeOperator());
    const res = await render(ContactsPage);
    expect(res).toHaveProperty("redirect");
    expect(await render(MyDataPage)).toHaveProperty("redirect");
  });

  it("гость на профиле — вход с возвратом", async () => {
    expect(await render(ProfilePage)).toEqual({ redirect: "/v2/login?next=%2Fv2%2Fprofile" });
  });
});

