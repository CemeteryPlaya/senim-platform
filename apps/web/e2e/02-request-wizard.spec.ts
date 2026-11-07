import { expect, test } from "@playwright/test";
import { choose, loginAs, P } from "./support";

/**
 * Мастер заявки (ТЗ п. 3, решение 2.2.11) для человека, который не разбирается в мебели: тип и пример картинкой,
 * уровень (без выбора дальше не пускает), фото можно пропустить, адрес обязателен. Сценарий только добавляет
 * новую заявку — пересев не нужен, номер берём с экрана.
 */

test("покупатель проходит мастер и видит заявку в «Мои заявки»", async ({ page }) => {
  await loginAs(page, P.daniyar);
  await page.goto("/requests/new");

  // 1. Что и стиль — плитки с картинками; технические поля спрятаны в «Для продвинутых»
  await expect(page.getByRole("heading", { level: 1, name: "Что делаем и в каком стиле?" })).toBeVisible();
  await expect(page.getByLabel("Ширина, см")).toBeHidden();
  await choose(page.getByRole("group", { name: "Что заказать" }).getByRole("radio", { name: "Кухня", exact: true }));
  await expect(page.getByRole("group", { name: "Пример, который нравится" }).getByRole("radio").first()).toBeVisible();
  await page.getByRole("button", { name: "Далее" }).click();

  // 2. Уровень — без выбора дальше не пускает
  await expect(page.getByRole("heading", { level: 1, name: "Какой уровень?" })).toBeVisible();
  await page.getByRole("button", { name: "Далее" }).click();
  await expect(page.getByText("Выберите уровень мебели")).toBeVisible();
  await choose(page.getByRole("radio", { name: /^Комфорт/ }));
  await page.getByRole("button", { name: "Далее" }).click();

  // 3. Фото и описание — без фото
  await expect(page.getByRole("heading", { level: 1, name: "Фото и описание" })).toBeVisible();
  await page.getByLabel("Опишите своими словами").fill("Кухня до потолка, нужна посудомойка");
  await page.getByRole("button", { name: "Далее" }).click();

  // 4. Где и когда — без адреса ошибка у поля
  await expect(page.getByRole("heading", { level: 1, name: "Где и когда" })).toBeVisible();
  await page.getByLabel("Город").fill("Астана");
  await page.getByLabel("Адрес или район").fill("");
  await page.getByRole("button", { name: "Далее" }).click();
  await expect(page.getByLabel("Адрес или район")).toHaveAttribute("aria-invalid", "true");
  await page.getByLabel("Адрес или район").fill("Астана, ул. Тестовая, 1, кв. 1");
  await page.getByRole("button", { name: "Далее" }).click();

  // 5. Проверка и отправка
  await expect(page.getByRole("heading", { level: 1, name: "Проверьте и отправьте" })).toBeVisible();
  const summary = page.getByRole("region", { name: "Ваша заявка" });
  await expect(summary.getByText("Кухня", { exact: true })).toBeVisible();
  await expect(summary.getByText("Кухня до потолка, нужна посудомойка")).toBeVisible();
  await expect(summary.getByText("Комфорт")).toBeVisible();
  await page.getByRole("button", { name: "Отправить заявку" }).click();

  await page.waitForURL(/\/requests\/[^/]+\?sent=1$/);
  await expect(page.getByText("Заявка отправлена")).toBeVisible();
  const title = await page.getByRole("heading", { level: 1 }).textContent();
  const number = title?.match(/^Заявка №(\d+): Кухня$/)?.[1];
  expect(number, `заголовок заявки: ${title}`).toBeTruthy();

  await page.goto("/requests");
  const item = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: `Заявка №${number}: Кухня` }) });
  await expect(item).toBeVisible();
  await expect(item.getByText("Комфорт")).toBeVisible();
});
