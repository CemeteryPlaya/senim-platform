import { expect, test, type Page } from "@playwright/test";
import { ru } from "@/i18n/ru";
import { formatMoney } from "@/kit";
import { computeDealMoney } from "@/modules/payments/client";
import { offerPath, seedBuyerState, seedOffer, type BuyerOffer } from "./offers";
import { open } from "./support";

/**
 * Экран предложения мастера глазами засеянного покупателя (Айгерим, тендер на кухню и сделка по прихожей): заголовок
 * «Предложение мастера» и подпись «Исполнитель №N» без имени, смета с защитой 2% из той же формулы, одно главное
 * действие, пояснение «Что это?», подтверждение «Принять» (открыть и отказаться) и ошибка у поля своей цены. Сценарий
 * ТОЛЬКО ЧИТАЕТ: ничего не принимается и не отправляется (ошибочная цена отклоняется схемой до модуля). Нужное состояние
 * берётся из сида; если его нет (сид изменил прогон flows) — падение с текстом «нужен пересев», а не пропуск.
 * Вход — через identity один раз на проект (состояние входа во временной папке ОС). Торг до сделки — flows/negotiation.
 */

const t = ru.app.offer;
/** Наименования мастеров сида (src/demo/data.ts): на экране покупателя до оферты их быть не должно. */
const LEGAL_NAMES = [/Жумабаев/, /Qazaq Wood/, /Абдрахманов/, /Ким Руслан/, /Ағаш/];

let stateFile = "";

test.beforeAll(async ({ browser }, info) => {
  test.setTimeout(120_000);
  stateFile = await seedBuyerState(browser, info.project.use.baseURL, `buyer-offer-${info.project.name}.json`);
});

test.use({ storageState: async ({}, provide) => provide(stateFile) });

async function openOffer(page: Page, offer: BuyerOffer): Promise<void> {
  await open(page, offerPath(offer));
  await expect(page.getByRole("heading", { level: 1, name: t.title })).toBeVisible();
  await expect(page.getByRole("main").getByText(`Исполнитель №${offer.publicNumber}`, { exact: true })).toBeVisible();
  await expect(page.locator("h1")).toHaveCount(1);
  expect(await page.locator("[data-primary-action]").count()).toBeLessThanOrEqual(1);
  const main = await page.getByRole("main").innerText();
  for (const name of LEGAL_NAMES) expect(main).not.toMatch(name);
  expect(await page.title()).not.toMatch(/Исполнитель|№/);
}

const openPrice = (offer: BuyerOffer): bigint => {
  const open = offer.rounds.find((r) => r.status === "PROPOSED");
  if (!open) throw new Error("нет открытой цены");
  return open.amountTiyn;
};

test("цена мастера: «Принять X», смета с защитой 2%, «Что это?», подтверждение без принятия, ошибка у поля своей цены", async ({ page }) => {
  const offer = await seedOffer("masterPrice");
  await openOffer(page, offer);

  const m = computeDealMoney(openPrice(offer));
  const primary = page.locator("[data-primary-action]");
  await expect(primary).toHaveText(t.actions.accept(formatMoney(m.priceTiyn)));
  const main = page.getByRole("main");
  await expect(main.getByText(t.money.title, { exact: true })).toBeVisible();
  await expect(main.getByText(t.money.protection, { exact: true })).toBeVisible();
  for (const amount of [m.protectionTiyn, m.buyerTotalTiyn]) await expect(main.getByText(formatMoney(amount)).first()).toBeVisible();

  // Пояснение защиты сделки: шторка на телефоне, поповер на компьютере.
  await page.getByRole("button", { name: t.money.explain.label }).click();
  await expect(page.getByText(t.money.explain.paragraphs[1])).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText(t.money.explain.paragraphs[1])).toBeHidden();

  // Подтверждение: цена, сумма к оплате и защита; «Отмена» — ничего не создано, адрес прежний.
  await primary.click();
  const dialog = page.getByRole("dialog", { name: t.acceptConfirm.title(formatMoney(m.priceTiyn)) });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(
    t.acceptConfirm.description({ price: formatMoney(m.priceTiyn), protection: formatMoney(m.protectionTiyn), total: formatMoney(m.buyerTotalTiyn) }),
  );
  await dialog.getByRole("button", { name: ru.app.kit.cancel }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`${offerPath(offer)}$`));

  // Своя цена: в окне — цена мастера; дробная — ошибка у поля, запрос в модуль не уходит (схема действия).
  await page.getByRole("button", { name: t.actions.propose }).click();
  const form = page.getByRole("dialog", { name: t.propose.title });
  await expect(form).toContainText(t.propose.masterPrice(formatMoney(m.priceTiyn)));
  await form.getByLabel(t.propose.amount).fill("12,5");
  await form.getByRole("button", { name: t.propose.submit }).click();
  await expect(form.getByText(t.errors.amount)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(form).toBeHidden();
});

test("своё предложение ждёт мастера: главного действия нет, «Отозвать предложение», смета под условием", async ({ page }) => {
  const offer = await seedOffer("waiting");
  await openOffer(page, offer);
  await expect(page.getByRole("heading", { level: 2, name: t.now.waiting.title })).toBeVisible();
  await expect(page.locator("[data-primary-action]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: t.actions.withdraw })).toBeVisible();
  await expect(page.getByText(t.money.titleWaiting, { exact: true })).toBeVisible();
  await expect(page.getByText(t.money.price.yours, { exact: true })).toBeVisible();
});

test("мастер ответил новой ценой: «Принять» его цену; история цены", async ({ page }) => {
  const offer = await seedOffer("masterCounter");
  await openOffer(page, offer);
  const price = formatMoney(openPrice(offer));
  await expect(page.getByRole("heading", { level: 2, name: t.now.masterCounter.title(price) })).toBeVisible();
  await expect(page.locator("[data-primary-action]")).toHaveText(t.actions.accept(price));
  await expect(page.getByRole("list", { name: t.history.title })).toContainText(t.history.status.SUPERSEDED);
});

test("цена принята: «Открыть сделку» ведёт в сделку, денег на экране нет; отклонённое — объяснение без действий", async ({ page }) => {
  const deal = await seedOffer("deal");
  await openOffer(page, deal);
  await expect(page.locator("[data-primary-action]")).toHaveText(t.actions.openDeal);
  await expect(page.locator("[data-primary-action]")).toHaveAttribute("href", `/v2/deals/${deal.dealId}`);
  await expect(page.getByRole("main")).not.toContainText(t.money.total);

  // Отклонённое предложение тендера (с историей торга), а не отклик сценария до договора — у того раундов нет.
  const other = await seedOffer("otherChosen", (o) => o.rounds.length > 0);
  await openOffer(page, other);
  await expect(page.getByRole("heading", { level: 2, name: t.now.otherChosen.title })).toBeVisible();
  await expect(page.locator("[data-primary-action]")).toHaveCount(0);
  await expect(page.getByRole("list", { name: t.history.title })).toContainText(t.history.notAccepted);
});
