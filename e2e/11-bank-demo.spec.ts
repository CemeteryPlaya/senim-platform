import { expect, test, type Page } from "@playwright/test";
import { reseed } from "./support";

/**
 * /bank-demo (только DEMO_MODE): семь шагов сценария видны, кнопка «Войти как … и открыть»
 * входит под персоной шага и открывает его экран. Шаги выбирают записи по состоянию данных,
 * поэтому начинаем со свежего сида (данные сценарий не меняет — только сессии).
 */

test.beforeAll(() => {
  test.setTimeout(120_000);
  reseed();
});

const STEPS = ["Заявка", "Отклики", "Замер", "Договор", "Пополнение эскроу", "Этапы и транши", "Закрытие"];

function step(page: Page, title: string) {
  return page.getByRole("listitem").filter({ has: page.getByRole("heading", { level: 3, name: new RegExp(`^${title}(,|$)`) }) });
}

test("шаги показа видны, в режиме manual шаг пополнения просит включить симулятор", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/bank-demo");
  await expect(page.getByRole("heading", { level: 1, name: "Показ банку" })).toBeVisible();
  for (const [i, title] of STEPS.entries()) {
    const item = step(page, title);
    await expect(item).toBeVisible();
    await expect(item.getByText(`Шаг ${i + 1}`, { exact: true })).toBeVisible();
  }
  await expect(step(page, "Пополнение эскроу").getByRole("link", { name: "Включить симулятор" })).toBeVisible();
  // Карточка «Режим оплаты для новых сделок»: manual
  await expect(page.getByRole("heading", { name: "Режим оплаты для новых сделок" })).toBeVisible();
  await expect(page.getByRole("paragraph").filter({ hasText: /^Напрямую исполнителю$/ })).toBeVisible();
});

const OPEN = [
  { title: "Отклики", url: /\/requests\/[^/]+$/, heading: /^Заявка №19:/ },
  { title: "Замер", url: /\/executor\/measurements$/, heading: /^Замеры$/ },
  { title: "Договор", url: /\/deals\/[^/]+$/, heading: /^Сделка №14$/ },
  { title: "Этапы и транши", url: /\/deals\/[^/]+$/, heading: /^Сделка №\d+$/ },
  // Дефект: шаг берёт последнюю завершённую сделку без фильтра демо-персон (сейчас №10 Армана, isDemo=false),
  // вход за персону шага отвечает «Не найдено». Причина — src/modules/operator/bank-demo.ts, dealIn().
  { title: "Закрытие", url: /\/deals\/[^/]+$/, heading: /^Сделка №\d+$/, defect: "закрытие: персона шага не демо-персона" },
  { title: "Заявка", url: /\/requests\/new$/, heading: /^Что будем делать\?$/ },
] as const;

for (const s of OPEN) {
  test(`шаг «${s.title}»: «Войти как … и открыть» ведёт на экран шага`, async ({ page }) => {
    test.fail("defect" in s, "defect" in s ? s.defect : "");
    await page.context().clearCookies();
    await page.goto("/bank-demo");
    const item = step(page, s.title);
    const persona = item.getByText(/^Персона \(/);
    await expect(persona).toBeVisible();
    await item.getByRole("button", { name: /^Войти как .+ и открыть$/ }).click();
    await expect(page).toHaveURL(s.url, { timeout: 15_000 });
    await expect(page.getByRole("heading", { level: 1, name: s.heading })).toBeVisible();
  });
}
