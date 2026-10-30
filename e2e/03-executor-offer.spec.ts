import { expect, test } from "@playwright/test";
import { loginAs, openMyRequest, P, reseed } from "./support";

/**
 * Тендер №19 (кухня, Комфорт, заказчик Айгерим). Исполнитель №5 (ИП Ким, Комфорт) ещё не откликался:
 * видит тендер, отправляет отклик. Заказчик видит «Исполнитель №5» — без наименования и телефона.
 */

test.beforeAll(() => {
  test.setTimeout(120_000);
  reseed();
});

const LEAKS = [/Ким/, /Руслан/, /7\s*\(?700\)?\s*000\s*02\s*03/, /7000000203/];

test("исполнитель откликается на тендер, заказчик видит его анонимно", async ({ page }) => {
  await loginAs(page, P.kim);
  await expect(page).toHaveURL(/\/executor\/requests$/);
  await page.getByRole("link", { name: /^Открыть заявку ?: Заявка №19:/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: /^Заявка №19:/ })).toBeVisible();
  // До выбора отклика адрес скрыт
  await expect(page.getByText("Откроется после выбора вашего отклика")).toBeVisible();
  await expect(page.getByText("ул. Демонстрационная")).toHaveCount(0);

  await page.getByLabel("Предварительная цена, ₸").fill("1 120 000");
  await page.getByLabel("Срок изготовления, дней").fill("28");
  await page.getByLabel("Гарантия, месяцев").fill("24");
  await page.getByLabel("Комментарий заказчику").fill("Корпус ЛДСП Egger, фасады МДФ эмаль, фурнитура Blum.");
  await page.getByRole("button", { name: "Отправить отклик" }).click();
  await expect(page.getByText("Отклик отправлен")).toBeVisible();
  await expect(page.getByRole("button", { name: "Отозвать отклик" })).toBeVisible();

  // Заказчик: отклик в списке под номером, без имени и телефона
  await loginAs(page, P.aigerim);
  await openMyRequest(page, 19);
  const offers = page.getByRole("region", { name: /^Отклики/ });
  const card = offers.getByRole("article", { name: "Исполнитель №5" });
  await expect(card).toBeVisible();
  await expect(card.getByText("1 120 000")).toBeVisible();
  await expect(offers.getByRole("article")).toHaveCount(4);
  const main = page.getByRole("main");
  for (const leak of LEAKS) await expect(main).not.toContainText(leak);

  // Карточка отклика тоже анонимна
  await card.getByRole("link", { name: /^Подробнее/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Предложение Исполнителя №5" })).toBeVisible();
  for (const leak of LEAKS) await expect(page.getByRole("main")).not.toContainText(leak);
});
