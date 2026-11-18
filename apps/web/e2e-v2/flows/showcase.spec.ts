import { devices, expect, test, type Browser, type Locator, type Page, type TestInfo } from "@playwright/test";
import { ru } from "@/i18n/ru";
import { seedBuyerState, SEED_BUYER } from "../offers";
import { SEED_STREETS, seedProfileDeal } from "../profiles";
import { open } from "../support";

/**
 * Что из сделки видно в профиле мастера (спека 2026-11-17, 3.3–3.5; набор flows: отзыв и выбор меняют данные базы e2e).
 * Засеянная оконченная сделка Айгерим «Гостиная и ТВ-зона» (мастер — Qazaq Wood, район и ЖК в заявке, фото сдачи; отзыва и
 * выбора нет): до ответа покупателя страница мастера показывает сделку закрыто — без фото и места. Покупатель с карточки
 * сделки оставляет отзыв и под оценкой выбирает «фото, город и район, имя» → гость видит у сделки фото сдачи, «Астана, Есиль»
 * и подпись «— Айгерим», без улицы. Покупатель меняет выбор на закрытый («Изменить» на карточке сделки) → фото и место
 * исчезают, подпись — «— А.», отзыв остаётся. Вид компьютера проверяет второй гостевой контекст в конце.
 *
 * Отзыв по сделке один, поэтому сценарий идёт только в проекте flows-mobile (в flows-desktop — явный пропуск). Покупатель
 * входит через identity один раз (состояние во временной папке ОС), гость — контекст без входа. Подписи — только из ru.
 */

const r = ru.app.deal.review;
const s = ru.app.deal.showcase;
const g = ru.app.guest.executor;

/** Карточка сделки на странице мастера (`li#deal-<id>`). */
const dealOn = (page: Page, dealId: string): Locator => page.locator(`#deal-${dealId}`);

/** Выбрать вариант (радио или галочку) нажатием по подписи и убедиться, что он отмечен или снят. */
async function choose(page: Page, role: "radio" | "checkbox", label: string, checked = true): Promise<void> {
  const input = page.getByRole(role, { name: label, exact: true });
  if ((await input.isChecked()) !== checked) await page.getByText(label, { exact: true }).click();
  if (checked) await expect(input).toBeChecked();
  else await expect(input).not.toBeChecked();
}

/** Гость (без входа) на странице мастера: карточка сделки — заголовок, итог; улиц покупателей на странице нет. */
async function guestDeal(browser: Browser, info: TestInfo, publicNumber: number, dealId: string, title: string, device = devices["Pixel 7"]): Promise<{ page: Page; deal: Locator; close: () => Promise<void> }> {
  const context = await browser.newContext({ ...device, baseURL: info.project.use.baseURL, locale: "ru-RU", timezoneId: "Asia/Almaty" });
  const page = await context.newPage();
  await open(page, `/v2/executors/${publicNumber}`);
  await expect(page.getByRole("heading", { level: 2, name: g.dealsTitle })).toBeVisible();
  const deal = dealOn(page, dealId);
  await expect(deal.getByRole("heading", { level: 3, name: title })).toBeVisible();
  await expect(deal).toContainText(g.outcome.success);
  await expect(page.getByRole("main")).not.toContainText(SEED_STREETS);
  return { page, deal, close: () => context.close() };
}

test("покупатель решает, что из сделки видно в профиле мастера: фото, город и район, имя — и обратно закрыто", async ({ browser }, info) => {
  test.skip(info.project.name !== "flows-mobile", "отзыв по сделке сида один на пересев: сценарий — в flows-mobile, вид компьютера — вторым контекстом в нём же");
  test.setTimeout(300_000);
  const pd = await seedProfileDeal(SEED_BUYER.phone);
  if (pd.reviewed || pd.showcased) throw new Error("Сделка сида уже с отзывом или выбором показа — нужен пересев (E2E_FLOWS=1)");
  expect(pd.status).toBe("SPLIT_PAYOUT");

  // ── До ответа покупателя: сделка в профиле мастера закрыта — без фото, места и отзыва.
  const before = await guestDeal(browser, info, pd.publicNumber, pd.dealId, pd.title);
  await expect(before.deal.locator("img")).toHaveCount(0);
  await expect(before.deal).not.toContainText(g.dealPlace);
  await expect(before.deal.locator("figcaption")).toHaveCount(0);
  await before.close();

  // ── Покупатель: отзыв с выбором «фото, город и район, имя».
  const storageState = await seedBuyerState(browser, info.project.use.baseURL, "showcase-flow.json");
  const buyer = await browser.newContext({ ...devices["Pixel 7"], baseURL: info.project.use.baseURL, locale: "ru-RU", timezoneId: "Asia/Almaty", storageState });
  const page = await buyer.newPage();
  const cardPath = `/v2/deals/${pd.dealId}`;
  await open(page, cardPath);
  await expect(page.locator("h1")).toHaveText(pd.title);
  await expect(page.getByText(s.line(s.summary.unanswered), { exact: true })).toBeVisible();
  await expect(page.locator("[data-primary-action]")).toHaveAttribute("href", `${cardPath}/review`);
  await page.locator("[data-primary-action]").click();
  await page.waitForURL(new RegExp(`${cardPath}/review$`));
  await page.waitForLoadState("networkidle");
  await expect(page.locator("h1")).toHaveText(r.title);
  // Вариант «Город, район и ЖК» есть: в заявке указаны и район, и ЖК.
  await expect(page.getByRole("radio", { name: s.address.COMPLEX, exact: true })).toHaveCount(1);
  await choose(page, "radio", r.rating(5));
  await page.getByLabel(r.textLabel).fill("ТВ-зону собрали аккуратно, полки ровные, провода спрятали.");
  await choose(page, "checkbox", s.photos);
  await choose(page, "checkbox", s.price, false);
  await choose(page, "radio", s.address.DISTRICT!);
  await choose(page, "radio", s.signature.NAME!);
  await page.getByRole("button", { name: r.submit, exact: true }).dblclick();
  await page.waitForURL(new RegExp(`${cardPath}$`));
  const open1 = s.line(s.summary.of({ photos: true, price: false, address: "DISTRICT", signature: "NAME" }));
  await expect(page.getByText(open1, { exact: true })).toBeVisible();

  // Гость: фото сдачи, «Астана, Есиль», подпись «— Айгерим»; стоимости нет.
  const shown = await guestDeal(browser, info, pd.publicNumber, pd.dealId, pd.title);
  await expect(shown.deal.locator("img").first()).toBeVisible();
  await expect(shown.deal.getByText(g.dealPlace, { exact: true })).toBeVisible();
  await expect(shown.deal.getByText("Астана, Есиль", { exact: true })).toBeVisible();
  await expect(shown.deal).not.toContainText(g.dealPrice);
  await expect(shown.deal).not.toContainText("Тестовый квартал");
  await expect(shown.deal.getByText(g.reviewRating(5), { exact: true })).toBeVisible();
  await expect(shown.deal.locator("figcaption")).toHaveText(g.reviewSignature("Айгерим"));
  await expect(shown.deal).not.toContainText("Сапарова");
  await shown.close();

  // ── Покупатель меняет выбор на закрытый: «Изменить» на карточке сделки.
  await page.getByRole("link", { name: s.change, exact: true }).click();
  await page.waitForURL(new RegExp(`${cardPath}/showcase$`));
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("checkbox", { name: s.photos, exact: true })).toBeChecked();
  await choose(page, "checkbox", s.photos, false);
  await choose(page, "radio", s.address.NONE!);
  await choose(page, "radio", s.signature.INITIAL!);
  await page.getByRole("button", { name: s.submit, exact: true }).dblclick();
  await page.waitForURL(new RegExp(`${cardPath}$`));
  const closed = s.line(s.summary.of({ photos: false, price: false, address: "NONE", signature: "INITIAL" }));
  await expect(page.getByText(closed, { exact: true })).toBeVisible();
  await buyer.close();

  // Гость (на компьютере): фото и места нет, подпись — «— А.», отзыв на месте.
  const hidden = await guestDeal(browser, info, pd.publicNumber, pd.dealId, pd.title, devices["Desktop Chrome"]);
  await expect(hidden.deal.locator("img")).toHaveCount(0);
  await expect(hidden.deal).not.toContainText(g.dealPlace);
  await expect(hidden.deal).not.toContainText("Есиль");
  await expect(hidden.deal.getByText(g.reviewRating(5), { exact: true })).toBeVisible();
  await expect(hidden.deal.locator("figcaption")).toHaveText(g.reviewSignature("А."));
  await expect(hidden.page.getByRole("main")).not.toContainText("Айгерим");
  await hidden.close();
});
