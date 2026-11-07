import { expect, test, type Page } from "@playwright/test";
import { amount, dealMoney, reseed } from "./support";

/**
 * /bank-demo (только DEMO_MODE): восемь шагов пути ТЗ, у шагов — «Войти как … и открыть», провайдер новых
 * сделок — ручной (e2e-сервер запущен с PAYMENT_PROVIDER=manual), разбор сделки — деньги из журнала.
 * Данные сценарий не меняет — только сессии.
 */

test.beforeAll(() => {
  test.setTimeout(120_000);
  reseed();
});

const STEPS = ["Заказ", "Отклик и торг", "Оферта", "Оплата", "Работа и сдача", "Акт приёмки", "Пакет на раскрытие и выплата", "Итог"];

function step(page: Page, title: string) {
  return page.getByRole("listitem").filter({ has: page.getByRole("heading", { level: 3, name: new RegExp(`^${title}(,|$)`) }) });
}

test("восемь шагов показа, честная пометка и ручной провайдер", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/bank-demo");
  await expect(page.getByRole("heading", { level: 1, name: "Показ банку" })).toBeVisible();
  await expect(page.getByText(/^Тестовые данные\. Банк без API/)).toBeVisible();
  for (const [i, title] of STEPS.entries()) {
    const item = step(page, title);
    await expect(item).toBeVisible();
    await expect(item.getByText(`Шаг ${i + 1}`, { exact: true })).toBeVisible();
  }
  await expect(page.getByText("ручной: оператор по банковским документам")).toBeVisible();
});

test("разбор сделки №10 (manual): суммы по формуле из журнала", async ({ page }) => {
  const m = dealMoney(2_750_000);
  await page.context().clearCookies();
  await page.goto("/bank-demo?deal=10");
  const summary = page.getByRole("main");
  await expect(summary).toContainText(amount(m.price));
  await expect(summary).toContainText(amount(m.buyerTotal));
  await expect(summary).toContainText(amount(m.payout));
  await expect(summary).toContainText(amount(m.income));
});

for (const title of ["Заказ", "Отклик и торг", "Оферта", "Оплата", "Акт приёмки"]) {
  test(`шаг «${title}»: «Войти как … и открыть» ведёт на экран шага под персоной`, async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/bank-demo");
    const item = step(page, title);
    await expect(item.getByText(/^Персона \(/)).toBeVisible();
    await item.getByRole("button", { name: /^Войти как .+ и открыть$/ }).click();
    await page.waitForURL((u) => u.pathname !== "/bank-demo" && u.pathname !== "/demo", { timeout: 30_000 });
    expect(new URL(page.url()).pathname).not.toMatch(/^\/login/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
}
