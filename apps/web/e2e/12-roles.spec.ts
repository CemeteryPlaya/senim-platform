import { expect, test } from "@playwright/test";
import { loginAs, P, reseed } from "./support";

/**
 * Две роли на одном аккаунте (ADR-004): мастер «Дала» (Исп. №4) заказывал шкаф как покупатель (сделка №17).
 * В «Сделках» видны сделки обеих ролей с пометкой; сделка другой роли открывается через страницу
 * переключения роли, после переключения — сама сделка.
 */

test.beforeAll(() => {
  test.setTimeout(120_000);
  reseed();
});

test("сделка в роли покупателя открывается после переключения роли", async ({ page }) => {
  await loginAs(page, P.dala);
  await expect(page).toHaveURL(/\/executor\/requests$/);

  await page.goto("/deals");
  const asClient = page.getByRole("listitem").filter({ hasText: "Вы — покупатель" });
  await expect(asClient).toHaveCount(1);
  await expect(page.getByRole("listitem").filter({ hasText: "Вы — мастер" })).toHaveCount(2); // №5 и №8

  await asClient.getByRole("link", { name: /^Открыть/ }).click();
  await page.waitForURL(/\/switch-role\?/);
  const main = page.getByRole("main");
  await expect(main.getByText("Эта страница открывается в роли «Заказчик».")).toBeVisible();
  await main.getByRole("button", { name: "Перейти в роль «Заказчик»" }).click();

  await page.waitForURL(/\/deals\/[^/?]+$/);
  await expect(page.getByRole("heading", { level: 1, name: "Сделка №17" })).toBeVisible();
  await expect(page.getByRole("main").getByText("Завершена", { exact: true }).first()).toBeVisible();
});
