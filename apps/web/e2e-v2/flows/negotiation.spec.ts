import { devices, expect, test, type Page } from "@playwright/test";
import { ru } from "@/i18n/ru";
import { formatMoney } from "@/kit";
import { computeDealMoney } from "@/modules/payments/client";
import { buyerOffers, offerPath, SEED_BUYER, seedBuyerState, seedOffer, type BuyerOffer } from "../offers";
import { open } from "../support";

/**
 * Торг до сделки (набор flows: база e2e пересеяна перед прогоном, данные меняются). Засеянный покупатель (Айгерим, тендер
 * на кухню) на предложении с ценой мастера предлагает свою цену (ошибка у поля, затем «ждём ответа»), отзывает её, а на
 * предложении со встречной ценой мастера принимает её двойным нажатием: одна сделка, переход на /v2/deals/<id>.
 * Итог на компьютере — в том же сценарии, вторым контекстом с окном компьютера: предложение ведёт в сделку, денег на нём
 * нет, два других предложения заявки закрыты.
 *
 * Сделка по тендеру сида одна на пересев, поэтому сценарий идёт только в проекте flows-mobile; в flows-desktop он явно
 * пропущен (вид компьютера проверяет второй контекст). Вход — через identity один раз (состояние во временной папке ОС).
 */

const t = ru.app.offer;

const heading2 = (page: Page, name: string) => page.getByRole("heading", { level: 2, name });

async function openOffer(page: Page, offer: BuyerOffer): Promise<void> {
  await open(page, offerPath(offer));
  await expect(page.getByRole("heading", { level: 1, name: t.title })).toBeVisible();
  await expect(page.getByRole("main").getByText(`Исполнитель №${offer.publicNumber}`, { exact: true })).toBeVisible();
  await expect(page.locator("h1")).toHaveCount(1);
  expect(await page.locator("[data-primary-action]").count()).toBeLessThanOrEqual(1);
}

test("покупатель предлагает свою цену, отзывает её и принимает встречную цену мастера — одна сделка", async ({ browser }, info) => {
  test.skip(info.project.name !== "flows-mobile", "сделка по тендеру сида одна на пересев: сценарий — в flows-mobile, вид компьютера — вторым контекстом в нём же");
  test.setTimeout(240_000);
  const priced = await seedOffer("masterPrice");
  const countered = await seedOffer("masterCounter");
  const baseURL = info.project.use.baseURL;
  const storageState = await seedBuyerState(browser, baseURL, "negotiation-flow.json");
  const phone = await browser.newContext({ ...devices["Pixel 7"], baseURL, locale: "ru-RU", timezoneId: "Asia/Almaty", storageState });
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
});
