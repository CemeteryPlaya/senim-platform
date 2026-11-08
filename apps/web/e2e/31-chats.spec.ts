import { expect, test, type Page } from "@playwright/test";
import { loginAs, P, reseed } from "./support";

/**
 * Вкладка «Чат»: список диалогов по откликам. Тендер №18 сида: Айгерим ↔ Исполнитель №3 (Ерлан).
 * Заказчик видит исполнителя по режиму ADR-006, исполнитель — только «Заказчик»; клик ведёт в чат отклика.
 */

test.beforeAll(() => {
  test.setTimeout(120_000);
  reseed();
});

async function openTab(page: Page) {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Основное меню" }).getByRole("link", { name: "Чат", exact: true }).click();
  await page.waitForURL(/\/chats$/);
  await expect(page.getByRole("heading", { level: 1, name: "Чат" })).toBeVisible();
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test("заказчик: вкладка «Чат» показывает диалоги и ведёт в чат отклика", async ({ page }) => {
  await loginAs(page, P.aigerim);
  await openTab(page);
  const list = page.getByRole("list", { name: "Диалоги" });
  const row = list.getByRole("link", { name: /Исполнитель №3/ }).first();
  await expect(row).toBeVisible();
  await expect(list).not.toContainText("+7");
  await expectNoHorizontalScroll(page);

  await row.click();
  await page.waitForURL(/\/(requests\/[^/]+\/offers\/[^/]+|deals\/[^/]+)/);
  await expect(page.getByRole("log")).toBeVisible();
});

test("исполнитель: видит только свои отклики, заказчик подписан без имени", async ({ page }) => {
  await loginAs(page, P.erlan);
  await openTab(page);
  const list = page.getByRole("list", { name: "Диалоги" });
  await expect(list.getByRole("link", { name: /Заказчик/ }).first()).toBeVisible();
  await expect(list).not.toContainText("Айгерим");
  await expect(list).not.toContainText("Сапарова");
  await expectNoHorizontalScroll(page);

  await list.getByRole("link", { name: /Заказчик/ }).first().click();
  await page.waitForURL(/\/(executor\/requests|deals)\/[^/]+/);
  await expect(page.getByRole("log")).toBeVisible();
});

test("оператор: список диалогов пуст", async ({ page }) => {
  await loginAs(page, P.dinara);
  await page.goto("/chats");
  await expect(page.getByRole("heading", { name: "Диалогов пока нет" })).toBeVisible();
});

test.describe("320 px и шрифт 200 %", () => {
  test.use({ viewport: { width: 320, height: 640 } });
  for (const [title, persona] of [
    ["заказчик", P.aigerim],
    ["мастер", P.erlan],
  ] as const) {
    test(`${title}: список без горизонтальной прокрутки`, async ({ page }) => {
      await loginAs(page, persona);
      await page.goto("/chats");
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });
      await page.waitForTimeout(200);
      await expect(page.getByRole("list", { name: "Диалоги" })).toBeVisible();
      await expectNoHorizontalScroll(page);
    });
  }
});
