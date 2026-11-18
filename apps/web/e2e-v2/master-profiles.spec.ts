import { expect, test, type Page } from "@playwright/test";
import { ru } from "@/i18n/ru";
import { SEED_BUYER, seedBuyerState } from "./offers";
import { buyerCounts, MASTERS, masterNumbers, masterWithoutEnded, publicNumberOf, SEED_STREETS, seedProfileDeal } from "./profiles";
import { open } from "./support";

/**
 * Профили мастеров и история покупателя (спека 2026-11-17, 3.3, 3.7, 3.8) на засеянных данных — только чтение (пересев не
 * включается, данные не меняются). Ожидаемые числа берутся из базы e2e по тем же правилам, что у модулей: сценарии `flows`
 * меняют сделки, и числа должны сходиться в любом состоянии стенда.
 *
 * - Профиль засеянного покупателя (Айгерим): сводка «Заказов / Сделок / Успешно», история заказов со статусами (засеянная
 *   оконченная «Гостиная и ТВ-зона» — «Успешно», ведёт на сделку), «Вопросы и ответы» раскрываются.
 * - Страница мастера без входа: числа под заголовком (сделки, доля успешных), «Сделки на площадке» — только оконченные,
 *   ни одной улицы из адресов покупателей; приглашать гость не может. Мастер без оконченных сделок — без процента.
 * - Общий список мастеров: строка «Сделок: N · Успешных: M%» у карточки.
 */

const h = ru.app.profile.history;
const g = ru.app.guest.executor;
const list = ru.app.guest.executors;

const stat = (page: Page, group: string, label: string) =>
  page.getByRole("group", { name: group }).locator("dl").filter({ has: page.getByRole("term").filter({ hasText: new RegExp(`^${label}$`) }) }).getByRole("definition");

test("профиль покупателя: сводка заказов, история со статусами, «Вопросы и ответы»", async ({ browser }, info) => {
  test.setTimeout(180_000);
  const storageState = await seedBuyerState(browser, info.project.use.baseURL, `master-profiles-${info.project.name}.json`);
  const context = await browser.newContext({ ...info.project.use, storageState });
  const page = await context.newPage();
  const counts = await buyerCounts(SEED_BUYER.phone);
  const pd = await seedProfileDeal(SEED_BUYER.phone);

  await open(page, "/v2/profile");
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(stat(page, h.statsLabel, h.stats.orders)).toHaveText(String(counts.orders));
  await expect(stat(page, h.statsLabel, h.stats.deals)).toHaveText(String(counts.deals));
  await expect(stat(page, h.statsLabel, h.stats.successful)).toHaveText(String(counts.successful));
  expect(counts.successful).toBeGreaterThan(0);

  await expect(page.getByRole("heading", { level: 2, name: h.title })).toBeVisible();
  await expect(page.locator('main a[href^="/v2/deals/"], main a[href^="/v2/requests/"]')).toHaveCount(counts.orders);
  const done = page.locator(`main a[href="/v2/deals/${pd.dealId}"]`);
  await expect(done).toContainText(pd.title);
  await expect(done).toContainText(h.status.success);
  await expect(page.getByRole("main")).not.toContainText(/комисси|эскроу|платформ/i);

  // «Вопросы и ответы»: ответ скрыт, пока вопрос не раскрыт.
  const answer = page.getByText(h.faq.statuses.paragraphs[0], { exact: true });
  await expect(answer).toBeHidden();
  await page.getByText(h.faq.statuses.title, { exact: true }).click();
  await expect(answer).toBeVisible();

  await done.click();
  await page.waitForURL(new RegExp(`/v2/deals/${pd.dealId}$`));
  await expect(page.locator("h1")).toHaveText(pd.title);
  await context.close();
});

test("страница мастера без входа: числа, только оконченные сделки, ни одной улицы покупателя, без приглашения", async ({ page, context }) => {
  await context.clearCookies();
  const erlan = await masterNumbers(await publicNumberOf(MASTERS.erlan));
  expect(erlan.successRate).not.toBeNull();

  await open(page, `/v2/executors/${erlan.publicNumber}`);
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(stat(page, g.factsLabel, g.stats.deals)).toHaveText(String(erlan.deals));
  await expect(stat(page, g.factsLabel, g.stats.success)).toHaveText(g.stats.percent(erlan.successRate!));
  await expect(page.getByRole("heading", { level: 2, name: g.dealsTitle })).toBeVisible();
  await expect(page.locator('main li[id^="deal-"]')).toHaveCount(erlan.ended);
  await expect(page.getByRole("main")).not.toContainText(SEED_STREETS);
  await expect(page.getByRole("button", { name: new RegExp(`^${g.invite.pick}`) })).toHaveCount(0);
  await expect(page.locator("[data-primary-action]")).toHaveCount(1);

  // Сделки есть, оконченных нет — процента нет, подпись говорит почему.
  const fresh = await masterWithoutEnded();
  await open(page, `/v2/executors/${fresh.publicNumber}`);
  await expect(stat(page, g.factsLabel, g.stats.successNone)).toHaveText(g.emptyValue);
  await expect(page.getByText(g.dealsEmpty, { exact: true })).toBeVisible();

  // Общий список мастеров: у карточки — сделки и доля успешных.
  await open(page, "/v2/executors");
  await expect(page.locator("h1")).toHaveText(list.title);
  const card = page.locator("main article").filter({ has: page.locator(`a[href="/v2/executors/${erlan.publicNumber}"]`) });
  await expect(card).toContainText(list.statsLine(erlan.deals, erlan.successRate));
});
