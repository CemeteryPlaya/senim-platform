import { devices, expect, test, type Browser, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { ru } from "@/i18n/ru";
import { DEFAULT_FURNITURE_TYPES, SEGMENT_NAMES } from "@/verticals/furniture";
import { invitationsOf, MASTERS, personState, publicNumberOf, requestNumberOf } from "../profiles";
import { freshPhone, loginV2, open, passOnboarding } from "../support";

/**
 * Приглашение мастера к заказу (спека 2026-11-17, 3.1–3.2; набор flows: заказ и ответы мастеров меняют данные базы e2e).
 * Новый покупатель публикует заказ «Комфорта» (район и ЖК на шаге адреса) → «Посмотреть мастеров» на карточке заказа →
 * список, открытый для заказа → профиль мастера своей группы (Руслан Ким) → «Пригласить к заказу №N»; у мастера другой
 * группы (Тимур, «Эконом») кнопки нет — «Работает в другой ценовой группе». Ким видит «Вас пригласили» в «Заявках» и на
 * заявке и отказывается с причиной; покупатель видит причину в «Приглашённых мастерах». Второго мастера (Ерлан) покупатель
 * зовёт со страницы мастера без заказа в адресе — выбором заказа в шторке (на компьютере — в окне); Ерлан присылает
 * предложение, и приглашение становится «Прислал предложение».
 *
 * Покупатель каждый раз новый (свой заказ), поэтому сценарий идёт в обоих проектах flows — в окне своего проекта.
 * Мастера входят через identity один раз за проект (состояние во временной папке ОС). Подписи — только из ru.
 */

const w = ru.app.requests.wizard;
const card = ru.app.requestCard;
const guest = ru.app.guest;
const invite = guest.executor.invite;
const mt = ru.app.masterOffer;
const KITCHEN = DEFAULT_FURNITURE_TYPES[0].name;
const REASON = "Не успеваю к вашему сроку: цех занят до конца месяца";

const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

/** Новый покупатель публикует заказ-тендер «Комфорта» на кухню; возвращает id заказа (адрес карточки после отправки). */
async function publishTender(page: Page): Promise<string> {
  await open(page, "/v2/requests/new");
  await page.getByText(KITCHEN, { exact: true }).click();
  await button(page, w.next).click();
  await page.waitForURL(/step=segment/);
  await page.getByText(SEGMENT_NAMES.COMFORT, { exact: true }).click();
  await button(page, w.next).click();
  await page.waitForURL(/step=room/);
  await button(page, w.next).click();
  await page.waitForURL(/step=place/);
  await page.getByLabel(w.place.city, { exact: true }).fill("Астана");
  await page.getByLabel(w.place.district).selectOption("Есиль");
  await page.getByLabel(w.place.complex).fill("Тестовый квартал");
  await page.getByLabel(w.place.address).fill("ул. Достык, 5");
  await button(page, w.next).click();
  await page.waitForURL(/step=send/);
  await button(page, w.submit).click();
  await page.waitForURL(/\/v2\/requests\/[^/?]+\?sent=1/);
  const id = new URL(page.url()).pathname.split("/").at(-1);
  if (!id) throw new Error("Нет id заказа в адресе карточки");
  return id;
}

/** Контекст в окне проекта (телефон или компьютер) с сохранённым входом. */
function contextOf(browser: Browser, info: TestInfo, storageState: string): Promise<BrowserContext> {
  const device = info.project.name === "flows-desktop" ? devices["Desktop Chrome"] : devices["Pixel 7"];
  return browser.newContext({ ...device, baseURL: info.project.use.baseURL, locale: "ru-RU", timezoneId: "Asia/Almaty", storageState });
}

/** Карточка заказа покупателя: строка приглашённого мастера с его статусом. */
async function expectInvitation(page: Page, requestId: string, publicNumber: number, status: string): Promise<void> {
  await open(page, `/v2/requests/${requestId}`);
  await expect(page.getByRole("heading", { level: 2, name: card.invitations.section })).toBeVisible();
  const row = page.locator(`main a[href="/v2/executors/${publicNumber}"]`);
  await expect(row).toContainText(ru.common.executorLabel(publicNumber));
  await expect(row).toContainText(status);
}

test("покупатель приглашает мастеров к заказу: отказ с причиной у первого, предложение у второго", async ({ page, browser }, info) => {
  test.setTimeout(420_000);
  const [kimNo, erlanNo, timurNo] = await Promise.all([publicNumberOf(MASTERS.kim), publicNumberOf(MASTERS.erlan), publicNumberOf(MASTERS.timur)]);

  // ── Покупатель: новый человек публикует заказ; «Посмотреть мастеров» — список, открытый для этого заказа.
  await loginV2(page, freshPhone().typed);
  await passOnboarding(page);
  const requestId = await publishTender(page);
  const number = await requestNumberOf(requestId);
  await open(page, `/v2/requests/${requestId}`);
  await page.getByRole("link", { name: card.now.executors, exact: true }).click();
  await page.waitForURL(new RegExp(`/v2/executors\\?request=${requestId}$`));
  await expect(page.locator("h1")).toHaveText(guest.executors.title);
  await expect(page.getByText(guest.executors.forRequest(number), { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(guest.executors.backToRequest) }).first()).toHaveAttribute("href", `/v2/requests/${requestId}`);

  // Мастер другой ценовой группы: кнопки нет, строка о группе.
  await open(page, `/v2/executors/${timurNo}?request=${requestId}`);
  await expect(page.getByText(invite.otherSegment, { exact: true })).toBeVisible();
  await expect(button(page, invite.action(number))).toHaveCount(0);

  // Мастер своей группы — из списка: «Пригласить к заказу №N», после — «Приглашение отправлено».
  await open(page, `/v2/executors?request=${requestId}`);
  await page.locator(`main a[href="/v2/executors/${kimNo}?request=${requestId}"]`).click();
  await page.waitForURL(new RegExp(`/v2/executors/${kimNo}\\?request=`));
  await page.waitForLoadState("networkidle");
  await button(page, invite.action(number)).dblclick();
  await expect(page.getByText(invite.sent(number), { exact: true })).toBeVisible();
  await expect(button(page, invite.action(number))).toHaveCount(0);
  expect([...(await invitationsOf(requestId))]).toEqual([[kimNo, { status: "INVITED", reason: null }]]);
  await expectInvitation(page, requestId, kimNo, card.invitations.status.INVITED);

  // ── Мастер Ким: «Вас пригласили» в «Заявках» и на заявке; отказ с причиной.
  const kim = await contextOf(browser, info, await personState(browser, info.project.use.baseURL, MASTERS.kim, `invitations-${info.project.name}-kim.json`));
  const kimPage = await kim.newPage();
  await open(kimPage, "/v2/executor/requests");
  await expect(kimPage.locator(`main a[href="/v2/executor/requests/${requestId}"]`)).toContainText(ru.app.masterRequests.incoming.card.invited);
  await open(kimPage, `/v2/executor/requests/${requestId}`);
  await expect(kimPage.getByRole("main").getByText(mt.invited, { exact: true })).toBeVisible();
  await expect(kimPage.getByRole("main")).not.toContainText(/Достык|заказчик|отклик|комисси|эскроу/i);
  await button(kimPage, mt.decline.action).click();
  const decline = kimPage.getByRole("dialog", { name: mt.decline.title });
  await decline.getByRole("button", { name: mt.decline.submit, exact: true }).click();
  await expect(decline.getByText(mt.errors.declineReason)).toBeVisible();
  await decline.getByLabel(mt.decline.reasonLabel).fill(REASON);
  await decline.getByRole("button", { name: mt.decline.submit, exact: true }).click();
  await expect(kimPage.getByText(mt.toasts.declined)).toBeVisible();
  await expect(decline).toBeHidden();
  await expect(kimPage.getByRole("main").getByText(mt.invited, { exact: true })).toHaveCount(0);
  await expect(button(kimPage, mt.decline.action)).toHaveCount(0);
  await kim.close();

  // Покупатель видит причину; на странице мастера — «Мастер отказался…», кнопки нет.
  await expectInvitation(page, requestId, kimNo, card.invitations.declined(REASON));
  expect((await invitationsOf(requestId)).get(kimNo)).toEqual({ status: "DECLINED", reason: REASON });
  await open(page, `/v2/executors/${kimNo}?request=${requestId}`);
  await expect(page.getByText(invite.declined(number), { exact: true })).toBeVisible();

  // ── Второй мастер (Ерлан) — со страницы мастера без заказа в адресе: выбор заказа в шторке или окне.
  await open(page, `/v2/executors/${erlanNo}`);
  await button(page, invite.pick).click();
  const sheet = page.getByRole("dialog", { name: invite.sheet.title });
  await expect(sheet.getByText(invite.sheet.option(number, KITCHEN), { exact: true })).toBeVisible();
  await sheet.getByRole("button", { name: invite.sheet.submit, exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText(invite.sent(number), { exact: true })).toBeVisible();
  await expectInvitation(page, requestId, erlanNo, card.invitations.status.INVITED);

  // ── Мастер Ерлан: приглашение → своё предложение (цена и срок) → приглашение «Прислал предложение».
  const erlan = await contextOf(browser, info, await personState(browser, info.project.use.baseURL, MASTERS.erlan, `invitations-${info.project.name}-erlan.json`));
  const erlanPage = await erlan.newPage();
  await open(erlanPage, `/v2/executor/requests/${requestId}`);
  await expect(erlanPage.getByRole("main").getByText(mt.invited, { exact: true })).toBeVisible();
  await erlanPage.getByLabel(mt.form.price).fill("950 000");
  await erlanPage.getByLabel(mt.form.days).fill("30");
  await erlanPage.locator("[data-primary-action]").click();
  await expect(erlanPage.getByRole("heading", { level: 2, name: mt.now.waiting.title })).toBeVisible({ timeout: 30_000 });
  await erlan.close();

  await expectInvitation(page, requestId, erlanNo, card.invitations.status.OFFERED);
  expect((await invitationsOf(requestId)).get(erlanNo)?.status).toBe("OFFERED");
  // Предложение Ерлана — и среди предложений заказа.
  await expect(page.locator(`main a[href*="/v2/requests/${requestId}/offers/"]`)).toHaveCount(1);
});
