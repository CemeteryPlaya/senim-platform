import { expect, test } from "@playwright/test";
import { amount, dealMoney, loginAs, openMyRequest, P, reseed } from "./support";

/**
 * Тендер №18 сида (кухня, Комфорт, покупатель Айгерим): Исп. №5 (ИП Ким) ещё не откликался. До оферты адрес
 * скрыт от мастера; покупатель видит «Исполнитель №5» без наименования и телефона, а в торге — смету с 2%.
 */

test.beforeAll(() => {
  test.setTimeout(120_000);
  reseed();
});

const LEAKS = [/Ким/, /Руслан/, /7\s*\(?700\)?\s*000\s*02\s*03/, /7000000203/];

test("мастер откликается на тендер, покупатель видит его анонимно и смету", async ({ page }) => {
  await loginAs(page, P.kim);
  await expect(page).toHaveURL(/\/executor\/requests$/);
  await page.getByRole("link", { name: /^Заявка №18:/ }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: /^Заявка №18:/ })).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText("ул. Демонстрационная");

  await page.getByLabel("Ваша цена, ₸").fill("1 120 000");
  await page.getByLabel("Срок изготовления, дней").fill("28");
  await page.getByLabel("Гарантия, месяцев").fill("24");
  await page.getByLabel("Комментарий заказчику").fill("Корпус ЛДСП Egger, фасады МДФ эмаль, фурнитура Blum.");
  await page.getByRole("button", { name: "Отправить отклик" }).dblclick(); // двойной клик — один отклик
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
  const m = dealMoney(1_120_000);
  await expect(estimate).toContainText("Защита сделки (2%)");
  await expect(estimate).toContainText(amount(m.protection));
  await expect(estimate).toContainText(amount(m.buyerTotal));
  await expect(page.getByRole("main")).not.toContainText(/комисси|эскроу/i);
});
