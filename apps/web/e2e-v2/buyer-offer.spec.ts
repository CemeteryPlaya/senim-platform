import { expect, test, type Page } from "@playwright/test";
import { ru } from "@/i18n/ru";
import { formatMoney } from "@/kit";
import { computeDealMoney } from "@/modules/payments/client";
import { findOffer, offerPath, SEED_BUYER, signInSeedBuyer, type BuyerOffer } from "./offers";
import { open } from "./support";

/**
 * Экран предложения мастера глазами засеянного покупателя (Айгерим, тендер на кухню и сделка по прихожей): «Исполнитель №N»
 * без имени, смета с защитой 2% из той же формулы, одно главное действие, пояснение «Что это?», подтверждение «Принять»
 * (открыть и отказаться) и ошибка у поля своей цены. Сценарий ТОЛЬКО ЧИТАЕТ: ничего не принимается и не отправляется
 * (ошибочная цена отклоняется схемой до модуля). Состояние, которого в базе уже нет (её изменил прогон flows), — пропуск
 * с причиной. Торг до сделки — e2e-v2/flows/negotiation.spec.ts.
 */

const t = ru.app.offer;
const AIGERIM = SEED_BUYER.phone;
/** Наименования мастеров сида (src/demo/data.ts): на экране покупателя до оферты их быть не должно. */
const LEGAL_NAMES = [/Жумабаев/, /Qazaq Wood/, /Абдрахманов/, /Ким Руслан/, /Ағаш/];

let page: Page;

test.beforeEach(async ({ page: p }) => {
  page = p;
  await signInSeedBuyer(p);
});

async function openOffer(offer: BuyerOffer): Promise<void> {
  await open(page, offerPath(offer));
  await expect(page.getByRole("heading", { level: 1, name: t.title(`Исполнитель №${offer.publicNumber}`) })).toBeVisible();
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

test("цена мастера: «Принять X», смета с защитой 2%, «Что это?», подтверждение без принятия, ошибка у поля своей цены", async () => {
  const offer = await findOffer(AIGERIM, "masterPrice");
  test.skip(!offer, "в базе нет цены мастера, ждущей ответа (её изменил прогон flows): пересейте базу e2e");
  if (!offer) return;
  await openOffer(offer);

  const m = computeDealMoney(openPrice(offer));
  const primary = page.locator("[data-primary-action]");
  await expect(primary).toHaveText(t.actions.accept(formatMoney(m.priceTiyn)));
  const main = page.getByRole("main");
  await expect(main.getByText(t.money.protection, { exact: true })).toBeVisible();
  for (const amount of [m.protectionTiyn, m.buyerTotalTiyn]) await expect(main.getByText(formatMoney(amount)).first()).toBeVisible();

  // Пояснение защиты сделки: шторка на телефоне, поповер на компьютере.
  await page.getByRole("button", { name: t.money.explain.label }).click();
  await expect(page.getByText(t.money.explain.paragraphs[1])).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText(t.money.explain.paragraphs[1])).toBeHidden();

  // Подтверждение: цена, защита и сумма к оплате; «Отмена» — ничего не создано, адрес прежний.
  await primary.click();
  const dialog = page.getByRole("dialog", { name: t.acceptConfirm.title(formatMoney(m.priceTiyn)) });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(`${formatMoney(m.priceTiyn)} + защита сделки 2% (${formatMoney(m.protectionTiyn)}) = ${formatMoney(m.buyerTotalTiyn)}`);
  await dialog.getByRole("button", { name: ru.app.kit.cancel }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`${offerPath(offer)}$`));

  // Своя цена: дробная — ошибка у поля, запрос в модуль не уходит (схема действия).
  await page.getByRole("button", { name: t.actions.propose }).click();
  const form = page.getByRole("dialog", { name: t.propose.title });
  await form.getByLabel(t.propose.amount).fill("12,5");
  await form.getByRole("button", { name: t.propose.submit }).click();
  await expect(form.getByText(t.errors.amount)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(form).toBeHidden();
});

test("своё предложение ждёт мастера: главного действия нет, «Отозвать предложение»", async () => {
  const offer = await findOffer(AIGERIM, "waiting");
  test.skip(!offer, "в базе нет своей цены, ждущей ответа: пересейте базу e2e");
  if (!offer) return;
  await openOffer(offer);
  await expect(page.getByRole("heading", { level: 2, name: t.now.waiting.title })).toBeVisible();
  await expect(page.locator("[data-primary-action]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: t.actions.withdraw })).toBeVisible();
  await expect(page.getByText(t.money.price.yours, { exact: true })).toBeVisible();
});

test("мастер ответил новой ценой: «Принять» его цену; история цены", async () => {
  const offer = await findOffer(AIGERIM, "masterCounter");
  test.skip(!offer, "в базе нет встречной цены мастера: пересейте базу e2e");
  if (!offer) return;
  await openOffer(offer);
  const price = formatMoney(openPrice(offer));
  await expect(page.getByRole("heading", { level: 2, name: t.now.masterCounter.title(price) })).toBeVisible();
  await expect(page.locator("[data-primary-action]")).toHaveText(t.actions.accept(price));
  await expect(page.getByRole("list", { name: t.history.title })).toContainText(t.history.status.SUPERSEDED);
});

test("цена принята: «Открыть сделку» ведёт в сделку; отклонённое предложение — объяснение без действий", async () => {
  const deal = await findOffer(AIGERIM, "deal");
  test.skip(!deal, "в базе нет сделки покупателя");
  if (!deal) return;
  await openOffer(deal);
  await expect(page.locator("[data-primary-action]")).toHaveText(t.actions.openDeal);
  await expect(page.locator("[data-primary-action]")).toHaveAttribute("href", `/v2/deals/${deal.dealId}`);

  const other = await findOffer(AIGERIM, "otherChosen");
  test.skip(!other, "в базе нет отклонённого предложения");
  if (!other) return;
  await openOffer(other);
  await expect(page.getByRole("heading", { level: 2, name: t.now.otherChosen.title })).toBeVisible();
  await expect(page.locator("[data-primary-action]")).toHaveCount(0);
});
