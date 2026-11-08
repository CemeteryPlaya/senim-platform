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

test("доступное имя ссылки — это её содержимое: собеседник, превью и «Чат закрыт»", async ({ page }) => {
  await loginAs(page, P.aigerim);
  await page.goto("/chats");
  const links = page.getByRole("list", { name: "Диалоги" }).getByRole("link");
  const count = await links.count();
  expect(count).toBeGreaterThan(0);
  let closed = 0;
  for (let i = 0; i < count; i++) {
    const link = links.nth(i);
    await expect(link).toHaveAccessibleName(/Исполнитель №\d+/);
    if ((await link.innerText()).includes("Чат закрыт")) {
      closed += 1;
      await expect(link).toHaveAccessibleName(/Чат закрыт/);
    }
  }
  // Превью первого диалога входит в имя (раньше его перекрывал aria-label).
  const preview = (await links.first().locator("span.line-clamp-2").innerText()).trim().slice(0, 12);
  // Знаки препинания заменяем «любым символом»: preview идёт в регулярное выражение.
  await expect(links.first()).toHaveAccessibleName(new RegExp(preview.replace(/[^\p{L}\p{N} ]/gu, ".")));
  expect(closed).toBeGreaterThan(0);
});
