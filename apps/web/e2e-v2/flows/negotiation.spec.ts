import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { devices, expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { ru } from "@/i18n/ru";
import { formatMoney } from "@/kit";
import { computeDealMoney, kztToTiyn } from "@/modules/payments/client";
import { buyerOffers, offerPath, SEED_BUYER, seedBuyerState, seedOffer, type BuyerOffer } from "../offers";
import { loginV2, open, passOnboarding } from "../support";

/**
 * Торг до сделки (набор flows: база e2e пересеяна перед прогоном, данные меняются). Засеянный покупатель (Айгерим, тендер
 * на кухню) на предложении с ценой мастера предлагает свою цену (ошибка у поля, затем «ждём ответа»), отзывает её, а на
 * предложении со встречной ценой мастера принимает её двойным нажатием: одна сделка, переход на /v2/deals/<id>.
 * Итог на компьютере — в том же сценарии, вторым контекстом с окном компьютера: предложение ведёт в сделку, денег на нём
 * нет, два других предложения заявки закрыты.
 *
 * Сторона мастера — в v2 (`/v2/executor/requests/<id>`), до того как покупатель примет цену: Руслан Ким (мастер того же
 * уровня без предложения по кухне) отправляет предложение формой с живым расчётом «Вы получите» (двойное нажатие — одно
 * предложение) и отзывает его целиком; Ерлан Жумабаев (его цену покупатель перебил своей) видит цену покупателя и
 * «Вы получите» в подтверждении «Принять», не принимает, а называет свою цену и отзывает её. После сделки по другому
 * предложению Ерлан на компьютере видит «Покупатель выбрал другого мастера». Мастер цену в этом сценарии не принимает:
 * сделка по тендеру сида одна (принять дважды — одна сделка — проверяют интеграционные тесты действий мастера).
 *
 * Сделка по тендеру сида одна на пересев, поэтому сценарий идёт только в проекте flows-mobile; в flows-desktop он явно
 * пропущен (вид компьютера проверяет второй контекст). Вход — через identity один раз на человека (состояние во временной
 * папке ОС).
 */

const t = ru.app.offer;
const mt = ru.app.masterOffer;

/** Засеянные мастера (src/demo/data.ts): Ерлан — с предложением по кухне, Руслан Ким — того же уровня, без предложения. */
const MASTERS = { erlan: "+77000000201", kim: "+77000000203" } as const;

/** Вход мастером через identity один раз за прогон: состояние — во временной папке ОС. */
async function masterState(browser: Browser, baseURL: string | undefined, phone: string, file: string): Promise<string> {
  const target = path.join(tmpdir(), "senim-e2e-v2", file);
  mkdirSync(path.dirname(target), { recursive: true });
  const context = await browser.newContext({ baseURL, locale: "ru-RU", timezoneId: "Asia/Almaty" });
  try {
    const page = await context.newPage();
    await loginV2(page, phone);
    await passOnboarding(page);
    await context.storageState({ path: target });
  } finally {
    await context.close();
  }
  return target;
}

const masterPath = (requestId: string) => `/v2/executor/requests/${requestId}`;

/** Экран заявки мастера: один h1, не больше одного главного действия; покупатель не назван, его 2% и «к оплате» не видны. */
async function openMaster(page: Page, requestId: string): Promise<void> {
  await open(page, masterPath(requestId));
  await expect(page.locator("h1")).toHaveCount(1);
  expect(await page.locator("[data-primary-action]").count()).toBeLessThanOrEqual(1);
  await expect(page.getByRole("main")).not.toContainText(/Айгерим|Сапарова|\+7\s?700|2\s?%|защит[аыеу] сделки|к оплате|комисси|эскроу|заказчик|отклик/i);
}

const heading2 = (page: Page, name: string) => page.getByRole("heading", { level: 2, name });

async function openOffer(page: Page, offer: BuyerOffer): Promise<void> {
  await open(page, offerPath(offer));
  await expect(page.getByRole("heading", { level: 1, name: t.title })).toBeVisible();
  await expect(page.getByRole("main").getByText(`Исполнитель №${offer.publicNumber}`, { exact: true })).toBeVisible();
  await expect(page.locator("h1")).toHaveCount(1);
  expect(await page.locator("[data-primary-action]").count()).toBeLessThanOrEqual(1);
}

test("мастер в v2 отправляет и отзывает предложение, торгуется; покупатель предлагает свою цену, отзывает её и принимает встречную цену мастера — одна сделка", async ({ browser }, info) => {
  test.skip(info.project.name !== "flows-mobile", "сделка по тендеру сида одна на пересев: сценарий — в flows-mobile, вид компьютера — вторым контекстом в нём же");
  test.setTimeout(360_000);
  const priced = await seedOffer("masterPrice");
  const countered = await seedOffer("masterCounter");
  const erlanOffer = await seedOffer("waiting", (o) => o.requestId === countered.requestId);
  const baseURL = info.project.use.baseURL;
  const phoneOf = (state: string): Promise<BrowserContext> =>
    browser.newContext({ ...devices["Pixel 7"], baseURL, locale: "ru-RU", timezoneId: "Asia/Almaty", storageState: state });
  const kitchen = countered.requestId;
  const offersOnKitchen = async () => (await buyerOffers(SEED_BUYER.phone)).filter((o) => o.requestId === kitchen);

  // ── Мастер Ким: форма предложения с живым расчётом, ошибка у поля, двойное нажатие — одно предложение; отзыв целиком.
  const kimState = await masterState(browser, baseURL, MASTERS.kim, "negotiation-flow-kim.json");
  const kim = await phoneOf(kimState);
  const kimPage = await kim.newPage();
  await openMaster(kimPage, kitchen);
  await expect(heading2(kimPage, mt.now.form.title)).toBeVisible();
  await expect(kimPage.getByRole("main")).toContainText(mt.request.addressHidden);
  const before = (await offersOnKitchen()).length;
  await kimPage.getByLabel(mt.form.price).fill("0");
  await kimPage.getByLabel(mt.form.days).fill("30");
  await kimPage.locator("[data-primary-action]").click();
  await expect(kimPage.getByText(mt.errors.price)).toBeVisible();
  await kimPage.getByLabel(mt.form.price).fill("1 010 000");
  const kimMoney = computeDealMoney(kztToTiyn(1_010_000));
  await expect(kimPage.getByRole("main")).toContainText(formatMoney(kimMoney.payoutTiyn));
  await expect(kimPage.getByRole("main")).toContainText(formatMoney(kimMoney.guaranteeTiyn));
  await expect(kimPage.getByRole("main")).not.toContainText(formatMoney(kimMoney.buyerTotalTiyn));
  await kimPage.locator("[data-primary-action]").dblclick();
  await expect(heading2(kimPage, mt.now.waiting.title)).toBeVisible({ timeout: 30_000 });
  await expect(kimPage.locator("[data-primary-action]")).toHaveCount(0);
  expect((await offersOnKitchen()).length).toBe(before + 1);
  await kimPage.getByRole("button", { name: mt.actions.menu }).click();
  await kimPage.getByRole("menuitem", { name: mt.actions.withdrawOffer }).click();
  await kimPage.getByRole("dialog", { name: mt.withdrawOfferConfirm.title }).getByRole("button", { name: mt.withdrawOfferConfirm.confirm }).click();
  await expect(heading2(kimPage, mt.now.withdrawn.title)).toBeVisible();
  expect((await offersOnKitchen()).filter((o) => o.offerStatus === "WITHDRAWN")).toHaveLength(1);
  await kim.close();

  // ── Мастер Ерлан: цена покупателя → «Принять X» показывает «Вы получите» (не принимает) → своя цена → отзыв цены.
  const erlanState = await masterState(browser, baseURL, MASTERS.erlan, "negotiation-flow-erlan.json");
  const erlan = await phoneOf(erlanState);
  const erlanPage = await erlan.newPage();
  const buyerPrice = erlanOffer.rounds.find((r) => r.status === "PROPOSED")?.amountTiyn;
  if (buyerPrice === undefined) throw new Error("нет открытой цены покупателя");
  const forErlan = computeDealMoney(buyerPrice);
  await openMaster(erlanPage, kitchen);
  await expect(heading2(erlanPage, mt.now.buyerPrice.title(formatMoney(buyerPrice)))).toBeVisible();
  await expect(erlanPage.locator("[data-primary-action]")).toHaveText(mt.actions.accept(formatMoney(buyerPrice)));
  await expect(erlanPage.getByRole("main")).toContainText(formatMoney(forErlan.payoutTiyn));
  await erlanPage.locator("[data-primary-action]").click();
  const acceptDialog = erlanPage.getByRole("dialog", { name: mt.acceptConfirm.title(formatMoney(buyerPrice)) });
  await expect(acceptDialog).toContainText(formatMoney(forErlan.payoutTiyn));
  await acceptDialog.getByRole("button", { name: ru.app.kit.cancel }).click();
  await expect(acceptDialog).toBeHidden();
  await erlanPage.getByRole("button", { name: mt.actions.propose }).click();
  const sheet = erlanPage.getByRole("dialog", { name: mt.propose.title });
  await sheet.getByLabel(mt.propose.amount).fill("1 000 000");
  await expect(sheet).toContainText(formatMoney(computeDealMoney(kztToTiyn(1_000_000)).payoutTiyn));
  await sheet.getByRole("button", { name: mt.propose.submit }).dblclick();
  await expect(sheet).toBeHidden();
  await expect(heading2(erlanPage, mt.now.waiting.title)).toBeVisible();
  const erlanRounds = (await offersOnKitchen()).find((o) => o.offerId === erlanOffer.offerId)?.rounds ?? [];
  expect(erlanRounds.filter((r) => r.party === "EXECUTOR" && r.status === "PROPOSED").map((r) => r.amountTiyn)).toEqual([kztToTiyn(1_000_000)]);
  await erlanPage.getByRole("button", { name: mt.actions.withdrawPrice }).click();
  await erlanPage.getByRole("dialog", { name: mt.withdrawPriceConfirm.title }).getByRole("button", { name: mt.withdrawPriceConfirm.confirm }).click();
  await expect(heading2(erlanPage, mt.now.youWithdrew.title)).toBeVisible();
  await expect(erlanPage.locator("[data-primary-action]")).toHaveText(mt.actions.propose);
  await erlan.close();

  // ── Покупатель.
  const storageState = await seedBuyerState(browser, baseURL, "negotiation-flow.json");
  const phone = await phoneOf(storageState);
  const page = await phone.newPage();

  // Своя цена на цену мастера: ошибка у поля, затем отправка — «Ждём ответа мастера», главного действия нет.
  await openOffer(page, priced);
  await page.getByRole("button", { name: t.actions.propose }).click();
  const form = page.getByRole("dialog", { name: t.propose.title });
  await form.getByLabel(t.propose.amount).fill("0");
  await form.getByRole("button", { name: t.propose.submit }).click();
  await expect(form.getByText(t.errors.amount)).toBeVisible();
  await form.getByLabel(t.propose.amount).fill("1 100 000");
  await form.getByRole("button", { name: t.propose.submit }).dblclick();
  await expect(form).toBeHidden();
  await expect(heading2(page, t.now.waiting.title)).toBeVisible();
  await expect(page.locator("[data-primary-action]")).toHaveCount(0);
  await expect(page.getByText(t.money.titleWaiting, { exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: t.history.title })).toContainText(t.history.you);
  expect((await buyerOffers(SEED_BUYER.phone)).find((o) => o.offerId === priced.offerId)?.rounds.filter((r) => r.party === "CLIENT")).toHaveLength(1);

  // Отозвать: подтверждение, после — своей цены, ждущей ответа, нет; главное — «Предложить свою цену».
  await page.getByRole("button", { name: t.actions.withdraw }).click();
  await page.getByRole("dialog", { name: t.withdrawConfirm.title }).getByRole("button", { name: t.withdrawConfirm.confirm }).click();
  await expect(heading2(page, t.now.youWithdrew.title)).toBeVisible();
  await expect(page.locator("[data-primary-action]")).toHaveText(t.actions.propose);
  await expect(page.getByRole("list", { name: t.history.title })).toContainText(t.history.status.WITHDRAWN);

  // Встречная цена мастера: «Принять X» → подтверждение с суммой к оплате → двойное нажатие → сделка.
  const price = countered.rounds.find((r) => r.status === "PROPOSED")?.amountTiyn;
  if (price === undefined) throw new Error("нет открытой цены мастера");
  const m = computeDealMoney(price);
  await openOffer(page, countered);
  await page.locator("[data-primary-action]").click();
  const confirm = page.getByRole("dialog", { name: t.acceptConfirm.title(formatMoney(m.priceTiyn)) });
  await expect(confirm).toContainText(formatMoney(m.buyerTotalTiyn));
  await confirm.getByRole("button", { name: t.acceptConfirm.confirm }).dblclick();
  await page.waitForURL(/\/v2\/deals\/[^/?#]+$/, { timeout: 30_000 });
  const dealId = new URL(page.url()).pathname.split("/").at(-1);

  // Одна сделка: у заявки в базе ровно она, по встречной цене мастера.
  const after = (await buyerOffers(SEED_BUYER.phone)).filter((o) => o.requestId === countered.requestId);
  expect(after.filter((o) => o.dealId !== null).map((o) => [o.offerId, o.dealId])).toEqual([[countered.offerId, dealId]]);
  await phone.close();

  // Итог на компьютере: предложение ведёт в сделку (цена строкой, без блока денег), остальные закрыты.
  const desktop = await browser.newContext({ ...devices["Desktop Chrome"], baseURL, locale: "ru-RU", timezoneId: "Asia/Almaty", storageState });
  const screen = await desktop.newPage();
  await openOffer(screen, countered);
  await expect(heading2(screen, t.now.deal.title)).toBeVisible();
  await expect(screen.getByRole("main")).toContainText(t.now.deal.body(formatMoney(m.priceTiyn)));
  await expect(screen.getByRole("main")).not.toContainText(t.money.total);
  await expect(screen.locator("[data-primary-action]")).toHaveAttribute("href", `/v2/deals/${dealId}`);
  const declined = after.filter((o) => o.offerStatus === "DECLINED");
  expect(declined).toHaveLength(2);
  for (const offer of declined) {
    await openOffer(screen, offer);
    await expect(heading2(screen, t.now.otherChosen.title)).toBeVisible();
    await expect(screen.locator("[data-primary-action]")).toHaveCount(0);
  }
  await desktop.close();

  // Мастер Ерлан на компьютере: покупатель выбрал другого мастера — торг закрыт, главного действия и меню отзыва нет.
  const erlanDesktop = await browser.newContext({ ...devices["Desktop Chrome"], baseURL, locale: "ru-RU", timezoneId: "Asia/Almaty", storageState: erlanState });
  const closed = await erlanDesktop.newPage();
  await openMaster(closed, kitchen);
  await expect(heading2(closed, mt.now.otherChosen.title)).toBeVisible();
  await expect(closed.locator("[data-primary-action]")).toHaveCount(0);
  await expect(closed.getByRole("button", { name: mt.actions.menu })).toHaveCount(0);
  await erlanDesktop.close();
});
