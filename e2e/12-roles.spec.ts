import { expect, test } from "@playwright/test";
import { loginAs, P, reseed } from "./support";

/**
 * Две роли на одном аккаунте (ADR-004): исполнитель «Дала» заказывал шкаф как заказчик.
 * В «Сделках» видны сделки обеих ролей с пометкой; сделка другой роли открывается через страницу
 * переключения роли, после переключения — сама сделка.
 */

test.beforeAll(() => {
  test.setTimeout(120_000);
  reseed();
});

test("сделка в роли заказчика открывается после переключения роли", async ({ page }) => {
  await loginAs(page, P.dala);
  await expect(page).toHaveURL(/\/executor\/requests$/);

  await page.goto("/deals");
  const asClient = page.getByRole("listitem").filter({ hasText: "Вы — заказчик" });
  await expect(asClient).toHaveCount(1);
  await expect(page.getByRole("listitem").filter({ hasText: "Вы — исполнитель" }).first()).toBeVisible();

  await asClient.getByRole("link", { name: /^Открыть/ }).click();
  await page.waitForURL(/\/switch-role\?/);
  const main = page.getByRole("main");
  await expect(main.getByText("Эта страница открывается в роли «Заказчик».")).toBeVisible();
  await main.getByRole("button", { name: "Перейти в роль «Заказчик»" }).click();

  await page.waitForURL(/\/deals\/[^/?]+$/);
  await expect(page.getByRole("heading", { level: 1, name: /^Сделка №\d+$/ })).toBeVisible();
});
