import { expect, test } from "@playwright/test";
import { choose, loginAs, P } from "./support";

/**
 * Прямой запрос по работе из каталога («Хочу похожее»): заявку получает только автор работы (Исп. №7, ИП Нурланова),
 * другие мастера её не видят. Сценарий только добавляет заявку — пересев не нужен.
 */

test("«Хочу похожее» из каталога: заявка уходит только автору работы", async ({ page }) => {
  await loginAs(page, P.madina);
  await page.goto("/catalog");
  await page.getByRole("link", { name: "Хочу похожее: «Обеденный стол из карагача», Исполнитель №7" }).click();
  await page.waitForURL(/\/requests\/new\?like=/);
  await expect(page.getByText("Заявку получит только Исполнитель №7 — автор понравившейся работы.")).toBeVisible();
  await page.getByRole("button", { name: "Далее" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Какой уровень?" })).toBeVisible();
  await choose(page.getByRole("radio", { name: /^Премиум/ }));
  await page.getByRole("button", { name: "Далее" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Фото и описание" })).toBeVisible();
  await page.getByLabel("Опишите своими словами").fill("Такой же стол, но на восемь человек");
  await page.getByRole("button", { name: "Далее" }).click();
  await page.getByLabel("Город").fill("Астана");
  await page.getByLabel("Адрес или район").fill("Астана, ул. Тестовая, 3, кв. 3");
  await page.getByRole("button", { name: "Далее" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Проверьте и отправьте" })).toBeVisible();
  await expect(page.getByText(/Заявку увидит только Исполнитель №7/).first()).toBeVisible();
  await page.getByRole("button", { name: "Отправить заявку" }).click();
  await page.waitForURL(/\/requests\/[^/]+\?sent=1$/);
  const title = (await page.getByRole("heading", { level: 1 }).textContent()) ?? "";
  const number = title.match(/^Заявка №(\d+):/)?.[1];
  expect(number, title).toBeTruthy();

  await loginAs(page, P.asel);
  await page.goto("/executor/requests");
  await expect(page.getByRole("link", { name: new RegExp(`^Заявка №${number}:`) }).first()).toBeVisible();

  await loginAs(page, P.erlan);
  await page.goto("/executor/requests");
  await expect(page.getByRole("link", { name: new RegExp(`^Заявка №${number}:`) })).toHaveCount(0);
});
