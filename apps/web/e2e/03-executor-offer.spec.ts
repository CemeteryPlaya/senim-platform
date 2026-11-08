import { expect, test } from "@playwright/test";
import { amount, dealMoney, expectNoHorizontalScrollAt320And200, expectOnePrimary, loginAs, openMyRequest, P, reseed, stepAction } from "./support";

/**
 * Тендер №18 сида (кухня, Комфорт, покупатель Айгерим): Исп. №5 (ИП Ким) ещё не откликался. До оферты адрес
 * скрыт от мастера; покупатель видит «Исполнитель №5» без наименования и телефона, а в торге — смету с 2%.
 */

// Сначала входящие: тендер №18 ещё без отклика Исп. №5 («Новая»), затем отклик на него.
test.beforeAll(() => {
  test.setTimeout(120_000);
  reseed();
});

const LEAKS = [/Ким/, /Руслан/, /7\s*\(?700\)?\s*000\s*02\s*03/, /7000000203/];

test("входящие мастера: сводка, чипы и карточки заявок; заявка без горизонтальной прокрутки", async ({ page }, info) => {
  await loginAs(page, P.kim);
  await page.goto("/executor/requests");
  const tiles = page.getByRole("main").getByRole("list", { name: "Сводка" });
  await expect(tiles.getByText("Новые заявки", { exact: true })).toBeVisible();
  await expect(tiles.getByText("В работе", { exact: true })).toBeVisible();
  // «Заработок за <месяц>» — на десктопе, из журнала выплат.
  const earned = tiles.getByText(/^Заработок за /);
  if (info.project.name === "desktop") await expect(earned).toBeVisible();
  else await expect(earned).toBeHidden();

  const chips = page.getByRole("navigation", { name: "Показать заявки" });
  await expect(chips.getByRole("link", { name: /^Все · \d+$/ })).toHaveAttribute("aria-current", "page");
  await chips.getByRole("link", { name: /^Новые · \d+$/ }).click();
  await page.waitForURL(/\/executor\/requests\?f=new$/);
  await expect(chips.getByRole("link", { name: /^Новые · \d+$/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: /^Заявка №18:/ }).first()).toContainText("Новая");
  await expect(chips.getByRole("link", { name: "Мои отклики", exact: true })).toHaveAttribute("href", "/executor/offers");
  await expect(page.getByRole("main").locator("[data-primary-action]")).toHaveCount(0);
  await expectNoHorizontalScrollAt320And200(page, "/executor/requests");

  await page.getByRole("link", { name: /^Заявка №18:/ }).first().click();
  await page.waitForURL(/\/executor\/requests\/[^/?]+$/);
  const path = new URL(page.url()).pathname;
  await expect(page.getByRole("main")).toContainText("Контакты заказчика откроются после оферты");
  await expectOnePrimary(page);
  await expectNoHorizontalScrollAt320And200(page, path);
});

test("мастер откликается на тендер, покупатель видит его анонимно и смету", async ({ page }) => {
  await loginAs(page, P.kim);
  await expect(page).toHaveURL(/\/executor\/requests$/);
  await page.getByRole("link", { name: /^Заявка №18:/ }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: /^Заявка №18:/ })).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText("ул. Демонстрационная");

  // Зеркальный расчёт до отправки: «Вы получите после приёмки» = цена − гарантия 4% (оракул ТЗ п. 6, не computeDealMoney).
  const m = dealMoney(1_120_000);
  const mirror = page.getByRole("main").getByRole("note").filter({ hasText: "Вы получите после приёмки" });
  await page.getByLabel("Ваша цена, ₸").fill("1 120 000");
  await expect(mirror).toContainText(amount(m.payout));
  await expect(mirror).toContainText("Гарантия оплаты и клиента (4%)");
  await expect(mirror).toContainText(amount(m.guarantee));
  await page.getByLabel("Срок изготовления, дней").fill("28");
  await page.getByLabel("Гарантия, месяцев").fill("24");
  await page.getByLabel("Комментарий заказчику").fill("Корпус ЛДСП Egger, фасады МДФ эмаль, фурнитура Blum.");
  // «Откликнуться» — единственная заливная кнопка экрана, в закреплённом слоте.
  await expectOnePrimary(page);
  await stepAction(page).getByRole("button", { name: "Откликнуться", exact: true }).dblclick(); // двойной клик — один отклик
  await expect(page.getByText("Отклик отправлен")).toBeVisible();
  await expect(page.getByRole("button", { name: "Отозвать отклик" })).toBeVisible();

  await loginAs(page, P.aigerim);
  await openMyRequest(page, 18);
  const offers = page.getByRole("region", { name: /^Отклики/ });
  const card = offers.getByRole("article", { name: "Исполнитель №5" });
  await expect(card).toHaveCount(1);
  await expect(card.getByText(/1\s120\s000/)).toBeVisible();
  await expect(offers.getByRole("article")).toHaveCount(4);
  for (const leak of LEAKS) await expect(page.getByRole("main")).not.toContainText(leak);

  await card.getByRole("link", { name: /^Подробнее/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Предложение Исполнителя №5" })).toBeVisible();
  for (const leak of LEAKS) await expect(page.getByRole("main")).not.toContainText(leak);
  const estimate = page.getByRole("region", { name: "Смета до оплаты" });
  await expect(estimate).toContainText("Защита сделки (2%)");
  await expect(estimate).toContainText(amount(m.protection));
  await expect(estimate).toContainText(amount(m.buyerTotal));
  await expect(page.getByRole("main")).not.toContainText(/комисси|эскроу/i);
});
