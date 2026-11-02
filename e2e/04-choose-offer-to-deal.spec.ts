import { expect, test } from "@playwright/test";
import { choose, loginAs, openMyRequest, P, reseed } from "./support";

/**
 * Тендер №19 (сценарий 1 «Замер исполнителем», ADR-005): заказчик (Айгерим) выбирает отклик Исполнителя №3 (Ерлан) →
 * исполнитель назначает замер, вносит итоговую цену и отправляет проект → заказчик утверждает проект и соглашается
 * на договор → создаётся сделка (ждёт подписей).
 */

test.beforeAll(() => {
  test.setTimeout(120_000);
  reseed();
});

/** Завтра в 11:00 по часам браузера — значение для поля datetime-local. */
function tomorrowAt11(): string {
  const d = new Date(Date.now() + 24 * 3600_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T11:00`;
}

test("выбор отклика → замер → итоговая цена → проект → согласие → сделка", async ({ page }) => {
  test.setTimeout(90_000);

  // 1. Заказчик выбирает отклик Исполнителя №3
  await loginAs(page, P.aigerim);
  await openMyRequest(page, 19);
  await page.getByRole("article", { name: "Исполнитель №3" }).getByRole("link", { name: /^Подробнее/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Предложение Исполнителя №3" })).toBeVisible();
  await page.getByRole("button", { name: "Выбрать и перейти к замеру" }).click();
  await page.getByRole("dialog", { name: "Выбрать Исполнителя №3?" }).getByRole("button", { name: "Да, выбрать" }).click();
  await page.waitForURL(/\/requests\/[^/]+$/);
  await expect(page.getByText("Вы выбрали Исполнителя №3")).toBeVisible();
  await expect(page.getByText("Отклик выбран").first()).toBeVisible();

  // 2. Исполнитель назначает замер: адрес заказчика теперь открыт
  await loginAs(page, P.erlan);
  await page.goto("/executor/measurements");
  await page.getByRole("link", { name: /^Назначить замер ?: Заявка №19:/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: /^Заявка №19:/ })).toBeVisible();
  await expect(page.getByText("Астана, ул. Демонстрационная, 12, кв. 45")).toBeVisible();
  await expect(page.getByText("Заказчик выбрал ваш отклик")).toBeVisible();
  await page.getByLabel("Дата и время замера").fill(tomorrowAt11());
  await page.getByRole("button", { name: "Назначить замер" }).click();
  await expect(page.getByText(/^Замер назначен: /)).toBeVisible();

  // 3. Итоговая цена после замера
  await page.getByLabel("Итоговая цена, ₸").fill("1 090 000");
  await page.getByLabel("Итог замера для заказчика").fill("Стена 3,4 м, добавили карниз и подсветку.");
  await page.getByRole("button", { name: "Внести итоговую цену" }).click();

  // 4. Проект: материалы и расшифровка стоимости; сумма строки по умолчанию — итоговая цена замера
  await expect(page.getByRole("heading", { name: "Утверждение проекта" })).toBeVisible();
  await page.getByLabel("Материалы").fill("ЛДСП Egger 16 мм, фасады МДФ в эмали, фурнитура Blum");
  await page.getByLabel("Строка 1: что входит").fill("Изготовление, доставка и монтаж");
  await expect(page.getByLabel("Строка 1: сумма, ₸")).toHaveValue("1090000");
  await page.getByRole("button", { name: "Отправить проект" }).click();
  await expect(page.getByText("Проект отправлен")).toBeVisible();

  // 5. Заказчик утверждает проект
  await loginAs(page, P.aigerim);
  await openMyRequest(page, 19);
  const project = page.getByRole("region", { name: "Утверждение проекта" });
  await expect(project.getByText("Изготовление, доставка и монтаж")).toBeVisible();
  await project.getByRole("button", { name: "Утвердить проект" }).click();
  await page.getByRole("dialog", { name: "Утвердить проект?" }).getByRole("button", { name: "Утвердить проект" }).click();

  // 6. Согласие с ценой проекта и порядком оплаты → сделка
  const measured = page.getByRole("region", { name: "Замер выполнен" });
  await expect(measured).toBeVisible();
  await expect(measured.getByText("1 090 000").first()).toBeVisible();
  await expect(measured.getByText("Стена 3,4 м, добавили карниз и подсветку.")).toBeVisible();
  await choose(measured.getByRole("radio", { name: /^Аванс 50% на материалы/ }));
  await measured.getByRole("button", { name: "Согласен, перейти к договору" }).click();

  await page.waitForURL(/\/deals\/[^/]+$/);
  await expect(page.getByRole("heading", { level: 1, name: /^Сделка №\d+$/ })).toBeVisible();
  await expect(page.getByText("Ждёт подписи договора")).toBeVisible();
  await expect(page.getByText("1 090 000").first()).toBeVisible();
  await expect(page.getByText("Исполнитель №3").first()).toBeVisible();

  // Заявка — в статусе «Договор», ведёт к сделке
  await openMyRequest(page, 19);
  await expect(page.getByText("Готовится договор")).toBeVisible();
  await expect(page.getByRole("link", { name: "Перейти к сделке" })).toBeVisible();
});
