import { expect, test } from "@playwright/test";
import { choose, loginAs, P } from "./support";

/**
 * Простой мастер заявки (встреча 31.10, п. 1) до отправки: тип плиткой, вид пропущен, размеры «не знаю»,
 * уровень, без фото, адрес. Сценарий только добавляет новую заявку, поэтому пересев не нужен: номер заявки берём с экрана.
 */

test("заказчик проходит мастер, ничего не зная о мебели, и видит заявку в «Мои заявки»", async ({ page }) => {
  await loginAs(page, P.daniyar);
  await page.goto("/requests/new");

  // 1. Что нужно? — плитка с картинкой
  await expect(page.getByRole("heading", { level: 1, name: "Что нужно?" })).toBeVisible();
  await choose(page.getByRole("group", { name: "Что заказать" }).getByRole("radio", { name: "Кухня", exact: true }));
  await page.getByRole("button", { name: "Далее" }).click();

  // 2. Какой примерно вид — пропускаем: исполнитель предложит
  await expect(page.getByRole("heading", { level: 1, name: "Какой примерно вид?" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Пример, который нравится" }).getByRole("radio")).toHaveCount(6);
  await page.getByRole("button", { name: "Пропустить" }).click();

  // 3. Размеры — по умолчанию «Не знаю — уточнит замер»
  await expect(page.getByRole("heading", { level: 1, name: "Размеры" })).toBeVisible();
  await expect(page.getByRole("radio", { name: /^Не знаю — уточнит замер/ })).toBeChecked();
  await expect(page.getByLabel("Ширина, см")).toHaveCount(0);
  await page.getByRole("button", { name: "Далее" }).click();

  // 4. Уровень — с объяснением; без выбора дальше не пускает
  await expect(page.getByRole("heading", { level: 1, name: "Какой уровень?" })).toBeVisible();
  await page.getByRole("button", { name: "Далее" }).click();
  await expect(page.getByText("Выберите уровень мебели")).toBeVisible();
  await choose(page.getByRole("radio", { name: /^Комфорт/ }));
  await page.getByRole("button", { name: "Далее" }).click();

  // 5. Фото и описание — без фото
  await expect(page.getByRole("heading", { level: 1, name: "Фото и описание" })).toBeVisible();
  await page.getByLabel("Опишите своими словами").fill("Кухня до потолка, нужна посудомойка");
  await page.getByRole("button", { name: "Далее" }).click();

  // 6. Где и когда — без адреса ошибка у поля
  await expect(page.getByRole("heading", { level: 1, name: "Где и когда" })).toBeVisible();
  await page.getByLabel("Город").fill("Астана");
  await page.getByLabel("Адрес или район").fill("");
  await page.getByRole("button", { name: "Далее" }).click();
  await expect(page.getByText("Укажите адрес: его увидит только выбранный исполнитель")).toBeVisible();
  await expect(page.getByLabel("Адрес или район")).toHaveAttribute("aria-invalid", "true");
  await page.getByLabel("Адрес или район").fill("Астана, ул. Тестовая, 1, кв. 1");
  await page.getByRole("button", { name: "Далее" }).click();

  // 7. Проверка и отправка
  await expect(page.getByRole("heading", { level: 1, name: "Проверьте и отправьте" })).toBeVisible();
  const summary = page.getByRole("region", { name: "Ваша заявка" });
  await expect(summary.getByText("Кухня", { exact: true })).toBeVisible();
  await expect(summary.getByText("Не знаю — уточнит замер")).toBeVisible();
  await expect(summary.getByText("Кухня до потолка, нужна посудомойка")).toBeVisible();
  await expect(summary.getByText("Комфорт")).toBeVisible();
  await page.getByRole("button", { name: "Отправить заявку" }).click();

  await page.waitForURL(/\/requests\/[^/]+\?sent=1$/);
  await expect(page.getByText("Заявка отправлена")).toBeVisible();
  const title = await page.getByRole("heading", { level: 1 }).textContent();
  const number = title?.match(/^Заявка №(\d+): Кухня$/)?.[1];
  expect(number, `заголовок заявки: ${title}`).toBeTruthy();
  await expect(page.getByText("Ждёт откликов").first()).toBeVisible();

  // «Мои заявки»: новая заявка в списке, отправлена (не черновик)
  await page.goto("/requests");
  const item = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: `Заявка №${number}: Кухня` }) });
  await expect(item).toBeVisible();
  await expect(item.getByText("Ждёт откликов")).toBeVisible();
  await expect(item.getByText("Комфорт")).toBeVisible();
  await expect(item.getByRole("link", { name: new RegExp(`^Заявка №${number}: Кухня$`) })).toBeVisible();
});
