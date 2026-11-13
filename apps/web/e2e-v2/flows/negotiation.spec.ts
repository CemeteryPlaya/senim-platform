import { expect, test, type Page } from "@playwright/test";
import { ru } from "@/i18n/ru";
import { formatMoney } from "@/kit";
import { computeDealMoney } from "@/modules/payments/client";
import { buyerOffers, findOffer, offerPath, SEED_BUYER, signInSeedBuyer, type BuyerOffer } from "../offers";
import { open } from "../support";

/**
 * Торг до сделки (набор flows: база e2e пересеяна перед прогоном, данные меняются). Засеянный покупатель (Айгерим, тендер
 * на кухню) на предложении с ценой мастера предлагает свою цену (ошибка у поля, затем «ждём ответа»), отзывает её, а на
 * предложении со встречной ценой мастера принимает её двойным нажатием: одна сделка, переход на /v2/deals/<id>; другие
 * предложения заявки закрыты. Сделка по тендеру одна на пересев: сценарий идёт в первом проекте flows (flows-mobile),
 * второй проект (flows-desktop) проверяет итог: предложение ведёт в сделку, остальные закрыты.
 */

const t = ru.app.offer;
const AIGERIM = SEED_BUYER.phone;

const heading2 = (page: Page, name: string) => page.getByRole("heading", { level: 2, name });

async function expectScreenRules(page: Page): Promise<void> {
  await expect(page.locator("h1")).toHaveCount(1);
  expect(await page.locator("[data-primary-action]").count()).toBeLessThanOrEqual(1);
}

/** Вход засеянным покупателем (одним нажатием на /demo): SMS-вход номера сида упирается в лимит кодов стенда. */
const signIn = signInSeedBuyer;

async function openOffer(page: Page, offer: BuyerOffer): Promise<void> {
  await open(page, offerPath(offer));
  await expect(page.getByRole("heading", { level: 1, name: t.title(`Исполнитель №${offer.publicNumber}`) })).toBeVisible();
  await expectScreenRules(page);
}

test.beforeEach(async ({ context }) => {
  await context.clearCookies();
});

test("покупатель предлагает свою цену, отзывает её и принимает встречную цену мастера — одна сделка", async ({ page }, info) => {
  test.skip(info.project.name !== "flows-mobile", "сделка по тендеру сида одна на пересев: торг идёт в flows-mobile");
  test.setTimeout(180_000);
  const priced = await findOffer(AIGERIM, "masterPrice");
  const countered = await findOffer(AIGERIM, "masterCounter");
  if (!priced || !countered) throw new Error("сид без цены мастера и встречной цены: база не пересеяна (E2E_FLOWS=1)");
  await signIn(page);

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
  await expect(page.getByText(t.money.price.yours, { exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: t.history.title })).toContainText(t.history.you);

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

  // Одна сделка: у предложения в базе ровно она, экран ведёт в неё; цена — встречная цена мастера.
  const after = (await buyerOffers(AIGERIM)).filter((o) => o.requestId === countered.requestId);
  expect(after.filter((o) => o.dealId !== null).map((o) => [o.offerId, o.dealId])).toEqual([[countered.offerId, dealId]]);
  await openOffer(page, countered);
  await expect(page.locator("[data-primary-action]")).toHaveAttribute("href", `/v2/deals/${dealId}`);
  await expect(page.getByRole("main")).toContainText(formatMoney(m.priceTiyn));

  // Другие предложения заявки закрыты.
  await openOffer(page, priced);
  await expect(heading2(page, t.now.otherChosen.title)).toBeVisible();
  await expect(page.locator("[data-primary-action]")).toHaveCount(0);
});

test("после торга: предложение ведёт в сделку, остальные предложения заявки закрыты", async ({ page }, info) => {
  test.skip(info.project.name !== "flows-desktop", "проверка итога торга flows-mobile — на компьютере");
  test.setTimeout(120_000);
  // Торг уже прошёл (flows-mobile): в тендере на кухню (три предложения) есть сделка, остальные отклики DECLINED.
  const all = await buyerOffers(AIGERIM);
  const tender = all.find((o) => o.dealId && !o.preContract && all.filter((x) => x.requestId === o.requestId).length >= 3);
  if (!tender) throw new Error("торг flows-mobile не дошёл до сделки (проекты flows идут по порядку: mobile, затем desktop)");
  const declined = all.filter((o) => o.requestId === tender.requestId && o.offerStatus === "DECLINED");
  expect(declined).toHaveLength(2);
  await signIn(page);

  await openOffer(page, tender);
  await expect(heading2(page, t.now.deal.title)).toBeVisible();
  await expect(page.locator("[data-primary-action]")).toHaveAttribute("href", `/v2/deals/${tender.dealId}`);
  for (const offer of declined) {
    await openOffer(page, offer);
    await expect(heading2(page, t.now.otherChosen.title)).toBeVisible();
    await expect(page.locator("[data-primary-action]")).toHaveCount(0);
  }
});
