import { expect, test } from "@playwright/test";
import { choose, expectNoHorizontalScroll, expectNoHorizontalScrollAt320And200, loginAs, P, reseed } from "./support";

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

/** Главное меню оператора: на десктопе — боковое, на телефоне — кнопка «Меню» в шапке (у оператора нет вкладок). */
const NAV = "Основное меню";
const SECTIONS = ["Деньги в банке", "Исполнители", "Документы мастеров", "Споры", "Заявки без откликов", "Сделки", "Доход платформы", "Отчёт", "Журнал аудита", "Типы мебели", "Флаги и окружение"];

test("оператор на телефоне 390 px: деньги в банке и таблицы без прокрутки страницы вбок", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAs(page, P.dinara);
  await page.goto("/operator/money");
  await expect(page.getByRole("heading", { level: 1, name: "Деньги в банке" })).toBeVisible();
  await expectNoHorizontalScroll(page);
  // Очереди решений: карточки равноправны — ни одна кнопка подтверждения не заливная.
  await expect(page.getByRole("button", { name: "Деньги поступили на счёт в банке" }).first()).toBeVisible();
  await expect(page.getByRole("main").locator("[data-primary-action]")).toHaveCount(0);
  await page.goto("/operator/kyc");
  await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
  await expect(page.getByRole("main").locator("[data-primary-action]")).toHaveCount(0);

  // Сводка на главной оператора — плитками.
  await page.goto("/operator");
  await expect(page.getByRole("list", { name: "Сводка" }).getByRole("listitem")).not.toHaveCount(0);
  await expectNoHorizontalScroll(page);

  // Таблица сделок прокручивается внутри своей области (фокус с клавиатуры), страница — нет.
  await page.goto("/operator/deals");
  const region = page.getByRole("region", { name: "Таблица «Сделки»" });
  await expect(region).toHaveAttribute("tabindex", "0");
  const table = region.getByRole("table", { name: "Сделки" });
  await expect(table.getByRole("link", { name: /^Сделка №\d+/ }).first()).toBeVisible();
  await expectNoHorizontalScroll(page);
  await expectNoHorizontalScrollAt320And200(page, "/operator/deals");
  await expectNoHorizontalScrollAt320And200(page, "/operator/money");

  // Разделы на телефоне — в «Меню» шапки, с теми же группами.
  await page.goto("/operator/money");
  await page.locator("summary", { hasText: "Меню" }).click();
  const menu = page.getByRole("navigation", { name: "Меню" });
  for (const label of SECTIONS) await expect(menu.getByRole("link", { name: label, exact: true })).toBeVisible();
  await expect(menu.getByRole("link", { name: "Деньги в банке", exact: true })).toHaveAttribute("aria-current", "page");
});

test("оператор на десктопе 1440 px: боковое меню с разделами по группам", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginAs(page, P.dinara);
  await page.goto("/operator/money");
  const nav = page.getByRole("navigation", { name: NAV });
  await expect(nav).toBeVisible();
  const box = await nav.boundingBox();
  expect(box?.x).toBeLessThanOrEqual(1);
  expect(box?.width).toBeGreaterThanOrEqual(238);
  for (const label of SECTIONS) await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
  for (const group of ["Очереди", "Сделки и отчёты", "Справочники и настройки"]) await expect(nav.getByRole("list", { name: group })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Деньги в банке", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.locator("summary", { hasText: "Меню" })).toBeHidden();
  // Списки без естественного главного действия — без заливной кнопки.
  await page.goto("/operator/deals");
  await expect(page.getByRole("main").locator("[data-primary-action]")).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  // Последний пункт меню достижим (меню прокручивается внутри колонки).
  const last = nav.getByRole("link").last();
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  // Общий список и экран сделки (/deals, /deals/[id]) — в меню оператора активны «Сделки».
  await page.goto("/deals");
  await expect(nav.getByRole("link", { name: "Сделки", exact: true })).toHaveAttribute("aria-current", "page");
  await page.getByRole("link", { name: /^Открыть: Сделка №\d+/ }).first().click();
  await page.waitForURL(/\/deals\/[^/]+$/);
  await expect(nav.getByRole("link", { name: "Сделки", exact: true })).toHaveAttribute("aria-current", "page");
});
