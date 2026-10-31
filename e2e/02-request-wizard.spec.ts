import { expect, test } from "@playwright/test";
import { choose, loginAs, P } from "./support";

/**
 * Мастер заявки до отправки с ответами «Не знаю». Сценарий только добавляет новую заявку,
 * поэтому пересев не нужен: номер заявки берём с экрана.
 */

const UNKNOWN = "Не знаю — подскажет исполнитель";

test("заказчик проходит мастер с «Не знаю» и видит заявку в «Мои заявки»", async ({ page }) => {
  await loginAs(page, P.daniyar);
  await page.goto("/requests/new");

  // 1. Что делаем
  await expect(page.getByRole("heading", { level: 1, name: "Что будем делать?" })).toBeVisible();
  await choose(page.getByRole("group", { name: "Тип мебели" }).getByRole("radio", { name: "Кухня", exact: true }));
  await page.getByRole("button", { name: "Далее" }).click();

  // 2. Стиль — пропускаем: исполнитель предложит
  await expect(page.getByRole("heading", { level: 1, name: "Какой стиль вам нравится?" })).toBeVisible();
  await page.getByRole("button", { name: "Пропустить" }).click();

  // 3. Помещение — без фото
  await expect(page.getByRole("heading", { level: 1, name: "Покажите помещение" })).toBeVisible();
  await page.getByRole("button", { name: "Пропустить" }).click();

  // 4. Размеры — «Не знаю»
  await expect(page.getByRole("heading", { level: 1, name: "Размеры" })).toBeVisible();
  await choose(page.getByRole("radio", { name: new RegExp(`^${UNKNOWN}`) }));
  await expect(page.getByLabel("Ширина, см")).toHaveCount(0);
  await page.getByRole("button", { name: "Далее" }).click();

  // 5. Материалы — «Не знаю» во всех списках
  await expect(page.getByRole("heading", { level: 1, name: "Материалы и фурнитура" })).toBeVisible();
  for (const label of ["Фасады", "Столешница", "Фурнитура"]) {
    await page.getByLabel(label, { exact: true }).selectOption({ label: UNKNOWN });
  }
  await page.getByRole("button", { name: "Далее" }).click();

  // 6. Уровень и отправка
  await expect(page.getByRole("heading", { level: 1, name: "Отправьте заявку" })).toBeVisible();
  const summary = page.getByRole("region", { name: "Проверьте заявку" });
  await expect(summary.getByText("Кухня")).toBeVisible();
  await expect(summary.getByText("Не знает — подскажите").first()).toBeVisible();

  // Без адреса — ошибка у поля, заявка не уходит
  await choose(page.getByRole("radio", { name: /^Комфорт/ }));
  await page.getByLabel("Город").fill("Астана");
  await page.getByLabel("Адрес", { exact: true }).fill("");
  await page.getByRole("button", { name: "Отправить заявку" }).click();
  await expect(page.getByText("Укажите адрес: его увидит только выбранный исполнитель")).toBeVisible();
  await expect(page.getByLabel("Адрес", { exact: true })).toHaveAttribute("aria-invalid", "true");

  await page.getByLabel("Адрес", { exact: true }).fill("Астана, ул. Тестовая, 1, кв. 1");
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
  await expect(item.getByRole("link", { name: new RegExp(`^Открыть ?: Заявка №${number}: Кухня$`) })).toBeVisible();
});
