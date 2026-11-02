import { expect, test, type Page } from "@playwright/test";
import { loginAs, P } from "./support";

/**
 * Доступ к чужим данным: чужая сделка и заявка — 404 без данных, гость уходит на вход
 * с возвратом, исполнитель и заказчик не попадают в раздел оператора. Данные не меняются.
 */

/** Адреса сделки №12 и заявки №20 Данияра — берём из его же списков. */
async function daniyarLinks(page: Page): Promise<{ deal: string; request: string }> {
  await loginAs(page, P.daniyar);
  await page.goto("/deals");
  const deal = await page.getByRole("link", { name: "Открыть: Сделка №12", exact: true }).getAttribute("href");
  await page.goto("/requests");
  const request = await page.getByRole("link", { name: /^Заявка №20:/ }).getAttribute("href");
  if (!deal || !request) throw new Error("Не нашли ссылки Данияра");
  return { deal, request };
}

test("заказчик и исполнитель не открывают чужие сделку и заявку", async ({ page }) => {
  const links = await daniyarLinks(page);

  await loginAs(page, P.aigerim);
  for (const href of [links.deal, links.request]) {
    const res = await page.goto(href);
    expect(res?.status(), href).toBe(404);
    await expect(page.getByRole("main")).not.toContainText(/Сделка №12|Заявка №20|Ахметов|Исполнитель №5/);
  }

  // Исполнитель №3 не участвует ни в сделке №12, ни в прямой заявке №20
  await loginAs(page, P.erlan);
  const deal = await page.goto(links.deal);
  expect(deal?.status()).toBe(404);
  const req = await page.goto(links.request.replace("/requests/", "/executor/requests/"));
  expect(req?.status()).toBe(404);
  await expect(page.getByRole("main")).not.toContainText(/Заявка №20/);
});

test("гость уходит на вход с адресом возврата", async ({ page }) => {
  const links = await daniyarLinks(page);
  await page.context().clearCookies();

  for (const path of [links.deal, "/requests/new", "/operator"]) {
    await page.goto(path);
    await page.waitForURL(/\/login\?/);
    expect(new URL(page.url()).searchParams.get("next"), path).toBe(path);
    await expect(page.getByLabel("Номер телефона")).toBeVisible();
  }
});

test("исполнитель и заказчик не попадают в раздел оператора", async ({ page }) => {
  for (const persona of [P.erlan, P.aigerim]) {
    await loginAs(page, persona);
    for (const path of ["/operator", "/operator/disputes", "/operator/executors"]) {
      await page.goto(path);
      await page.waitForURL(/\/login\?/);
      const url = new URL(page.url());
      expect(url.searchParams.get("reason")).toBe("role");
      expect(url.searchParams.get("next")).toBe(path);
      await expect(page.getByText("Эта страница доступна другой роли. Выйдите и войдите под нужным номером.")).toBeVisible();
      await expect(page.getByRole("main")).not.toContainText(/Очередь регистраций|Споры/);
    }
  }
});
