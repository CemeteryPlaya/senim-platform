import { expect, test } from "@playwright/test";
import { choose, loginAs, P, reseed } from "./support";

/**
 * Регистрация Исполнителя №10 (Алмас, PENDING, без сегмента): оператор Динара подтверждает
 * её с сегментом «Эконом». После этого исполнитель попадает к заявкам, а не на экран ожидания.
 */

test.beforeAll(() => {
  test.setTimeout(120_000);
  reseed();
});

test("оператор подтверждает регистрацию с сегментом", async ({ page }) => {
  // До подтверждения исполнитель видит экран ожидания
  await loginAs(page, P.almas);
  await expect(page.getByText("Ожидаем подтверждения оператором")).toBeVisible();

  await loginAs(page, P.dinara);
  await expect(page).toHaveURL(/\/operator$/);
  await page.goto("/operator/executors");
  const queue = page.getByRole("region", { name: "Очередь регистраций" });
  await queue.getByRole("link", { name: `Исполнитель №10: ${P.almas}` }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("№10");
  // ИИН в интерфейсе — только последние 4 цифры
  await expect(page.getByRole("main")).not.toContainText(/\d{12}/);

  await choose(page.getByRole("radio", { name: "Эконом", exact: true }));
  await page.getByRole("button", { name: "Подтвердить регистрацию" }).click();
  // Сообщение «Регистрация подтверждена» исчезает вместе с формой после обновления экрана (см. отчёт QA),
  // поэтому проверяем итог: формы решения нет, присвоен сегмент.
  await expect(page.getByRole("button", { name: "Подтвердить регистрацию" })).toHaveCount(0);
  await expect(page.getByText("Текущий сегмент: Эконом")).toBeVisible();

  await page.goto("/operator/executors");
  await expect(page.getByRole("region", { name: "Очередь регистраций" }).getByRole("link", { name: `Исполнитель №10: ${P.almas}` })).toHaveCount(0);

  // Исполнитель теперь работает с заявками своего сегмента
  await loginAs(page, P.almas);
  await expect(page).toHaveURL(/\/executor\/requests$/);
  await expect(page.getByRole("heading", { level: 1, name: "Заявки", exact: true })).toBeVisible();
});
