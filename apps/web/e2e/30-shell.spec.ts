import { expect, test, type Locator, type Page } from "@playwright/test";
import { loginAs, P, reseed } from "./support";

/**
 * Каркас v2: на телефоне и планшете — нижняя панель с подписями и действием роли в центре, на десктопе —
 * боковое меню 240 px. Закреплённая кнопка (StickyAction) не закрывает ни содержание, ни панель.
 */

const NAV = "Основное меню";

test.beforeAll(() => {
  test.setTimeout(120_000);
  reseed();
});

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1024;

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("у элемента нет рамки");
  return b;
}

async function scrollToBottom(page: Page) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(150);
}

test("заказчик: на телефоне нижняя панель из 5 вкладок, на десктопе боковое меню", async ({ page }) => {
  await loginAs(page, P.aigerim);
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: NAV });
  await expect(nav).toHaveCount(1);
  await expect(nav).toBeVisible();
  const b = await box(nav);

  if (isDesktop(page)) {
    expect(b.x).toBeLessThanOrEqual(1);
    expect(b.width).toBeGreaterThanOrEqual(238);
    expect(b.width).toBeLessThanOrEqual(242);
    await expect(nav.getByRole("link", { name: "Заявка" })).toBeVisible();
    // Заливная главная кнопка на экране одна — кнопка бокового меню мятная и без data-primary-action.
    await expect(nav.locator("[data-primary-action]")).toHaveCount(0);
    await expect(page.locator("[data-primary-action]")).toHaveCount(1);
    await expect(nav.getByRole("link", { name: "Главная" })).toHaveAttribute("aria-current", "page");
    return;
  }

  const viewport = page.viewportSize();
  if (!viewport) throw new Error("нет размера окна");
  // Панель у нижнего края, на всю ширину, не ниже 56 px.
  expect(b.x).toBeLessThanOrEqual(1);
  expect(b.width).toBeGreaterThanOrEqual(viewport.width - 1);
  expect(b.y + b.height).toBeGreaterThanOrEqual(viewport.height - 1);
  expect(b.height).toBeGreaterThanOrEqual(56);
  const links = nav.getByRole("link");
  await expect(links).toHaveCount(5);
  const labels = ["Главная", "Сделки", "Заявка", "Чат", "Профиль"];
  for (const [i, label] of labels.entries()) {
    const link = links.nth(i);
    await expect(link).toBeVisible();
    await expect(link).toHaveText(label);
    expect((await box(link)).height).toBeGreaterThanOrEqual(48);
  }
  await expect(links.nth(2)).toHaveAttribute("data-primary-tab", "true");
  await expect(links.nth(0)).toHaveAttribute("aria-current", "page");
});

test("мастер: вкладки роли", async ({ page }) => {
  await loginAs(page, P.erlan);
  await page.goto("/executor/requests");
  const nav = page.getByRole("navigation", { name: NAV });
  await expect(nav).toHaveCount(1);
  for (const label of ["Заявки", "Заказы", "Чат", "Финансы", "Профиль"]) {
    await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
  await expect(nav.getByRole("link", { name: "Заявки", exact: true })).toHaveAttribute("aria-current", "page");
});

test("гость: «Войти» одно на любой ширине, установка не пропала", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: NAV })).toBeVisible();
  // Вне содержания (шапка и меню) «Войти» ровно одно.
  const chrome = page.locator("header, nav").getByRole("link", { name: "Войти", exact: true });
  await expect(chrome).toHaveCount(1);
  await expect(chrome).toBeVisible();
});

test("детали: «Назад» видна, закреплённая кнопка не закрывает содержание и панель", async ({ page }) => {
  // Витрина компонентов (демо-режим): StickyAction стоит последним, как будет на экранах деталей.
  await loginAs(page, P.aigerim);
  await page.goto("/ui-kit");
  await expect(page.getByRole("main").getByRole("link", { name: "Назад" }).first()).toBeVisible();

  const sticky = page.locator("[data-sticky-action]");
  await expect(sticky).toHaveCount(1);
  await expect(sticky.locator("[data-primary-action]")).toHaveCount(1);
  const bar = page.getByRole("navigation", { name: NAV });
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("нет размера окна");

  // Вверху страницы: кнопка в окне и (на телефоне) над панелью.
  await page.evaluate(() => window.scrollTo(0, 0));
  const top = await box(sticky);
  if (isDesktop(page)) {
    expect(top.y).toBeGreaterThan(viewport.height); // на десктопе — в потоке, а не закреплена
  } else {
    expect(top.y + top.height).toBeLessThanOrEqual((await box(bar)).y + 1);
    expect(top.y).toBeGreaterThanOrEqual(0);
  }

  // Внизу: кнопка ниже последнего элемента содержания и над панелью.
  await scrollToBottom(page);
  const last = sticky.locator("xpath=preceding-sibling::*[1]");
  const lastBox = await box(last);
  const stickyBox = await box(sticky);
  expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(stickyBox.y + 1);
  if (!isDesktop(page)) expect(stickyBox.y + stickyBox.height).toBeLessThanOrEqual((await box(bar)).y + 1);
});

test("экран сделки: «Назад» видна, последний блок не под панелью", async ({ page }) => {
  await loginAs(page, P.aigerim);
  await page.goto("/deals");
  await page.getByRole("link", { name: /^Открыть: Сделка №\d+/ }).first().click();
  await page.waitForURL(/\/deals\/[^/]+$/);
  await expect(page.getByRole("link", { name: "Назад" })).toBeVisible();
  await scrollToBottom(page);
  const last = page.locator("main > :last-child");
  const lastBox = await box(last);
  if (!isDesktop(page)) {
    const bar = await box(page.getByRole("navigation", { name: NAV }));
    expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(bar.y + 1);
    // Подвал тоже над панелью: его ссылку видно целиком.
    const footerLink = await box(page.locator("footer").getByRole("link"));
    expect(footerLink.y + footerLink.height).toBeLessThanOrEqual(bar.y + 1);
  }
});

test.describe("320 px и шрифт 200 %", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  for (const [title, persona, path] of [
    ["заказчик", P.aigerim, "/"],
    ["заказчик, сделки", P.aigerim, "/deals"],
    ["мастер", P.erlan, "/executor/requests"],
    ["оператор", P.dinara, "/operator"],
  ] as const) {
    test(`${title}: нет горизонтальной прокрутки`, async ({ page }) => {
      await loginAs(page, persona);
      await page.goto(path);
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });
      await page.waitForTimeout(200);
      const overflow = await page.evaluate(() => {
        const el = document.scrollingElement;
        return el ? el.scrollWidth - window.innerWidth : 0;
      });
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});

test("оператор: разделы в меню; на телефоне — кнопка «Меню»", async ({ page }) => {
  await loginAs(page, P.dinara);
  await page.goto("/operator");

  if (isDesktop(page)) {
    const nav = page.getByRole("navigation", { name: NAV });
    await expect(nav).toBeVisible();
    for (const label of ["Оператор", "Сделки", "Профиль"]) await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
    await expect(page.locator("summary", { hasText: "Меню" })).toBeHidden();
  } else {
    // Нижней панели у оператора нет: её место отдано меню в шапке.
    await expect(page.getByRole("navigation", { name: NAV })).toHaveCount(0);
    const menu = page.locator("summary", { hasText: "Меню" });
    await expect(menu).toBeVisible();
    expect((await box(menu)).height).toBeGreaterThanOrEqual(48);
    await menu.click();
    const items = page.getByRole("navigation", { name: "Меню" });
    for (const label of ["Оператор", "Сделки", "Профиль"]) await expect(items.getByRole("link", { name: label, exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(items.getByRole("link", { name: "Сделки", exact: true })).toBeHidden();
  }

  await page.goto("/deals");
  await page.getByRole("link", { name: /^Открыть: Сделка №\d+/ }).first().click();
  await page.waitForURL(/\/deals\/[^/]+$/);
  await expect(page.getByRole("link", { name: "Назад" })).toBeVisible();
});
