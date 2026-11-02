import { expect, test, type Page } from "@playwright/test";
import { loginAs, openMyRequest, P, reseed } from "./support";

/**
 * Чат отклика №19 между заказчиком (Айгерим) и Исполнителем №3 (Ерлан): телефоны, ссылки
 * на мессенджеры и e-mail маскируются до сохранения — их не видит ни одна сторона.
 */

test.beforeAll(() => {
  test.setTimeout(120_000);
  reseed();
});

const FROM_CLIENT = "Позвоните мне: +7 701 123 45 67 или пишите в телеграм t.me/aigerim_kz";
const FROM_EXECUTOR = "Мой номер 8 (777) 555-44-33, почта erlan.master@example.com, whatsapp wa.me/77775554433";
const LEAKS = [/123\s*45\s*67/, /t\.me/, /aigerim_kz/, /555-44-33/, /example\.com/, /wa\.me/, /77775554433/];

async function send(page: Page, text: string) {
  await page.getByLabel("Ваше сообщение").fill(text);
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(page.getByLabel("Ваше сообщение")).toHaveValue("");
}

async function expectMasked(page: Page) {
  const log = page.getByRole("log");
  await expect(log.getByText("[контакт скрыт]").last()).toBeVisible();
  await expect(log.getByText("Контакты скрыты: общение идёт только в этом чате").last()).toBeVisible();
  for (const leak of LEAKS) await expect(log).not.toContainText(leak);
}

test("контакты в сообщениях скрываются у обеих сторон", async ({ page }) => {
  test.setTimeout(90_000);

  await loginAs(page, P.aigerim);
  await openMyRequest(page, 19);
  await page.getByRole("article", { name: "Исполнитель №3" }).getByRole("link", { name: /^Написать/ }).click();
  await expect(page.getByRole("heading", { name: "Написать Исполнителю №3" })).toBeVisible();
  await send(page, FROM_CLIENT);
  const own = page.getByRole("log").getByRole("listitem").last();
  await expect(own).toContainText("Позвоните мне:");
  await expectMasked(page);

  // Исполнитель видит сообщение уже замаскированным и отвечает своими контактами
  await loginAs(page, P.erlan);
  await page.getByRole("link", { name: /^Заявка №19:/ }).click();
  await expect(page.getByRole("heading", { name: "Чат с заказчиком" })).toBeVisible();
  await expect(page.getByRole("log")).toContainText("Позвоните мне:");
  await expectMasked(page);
  await send(page, FROM_EXECUTOR);
  await expect(page.getByRole("log").getByRole("listitem").last()).toContainText("Мой номер");
  await expectMasked(page);

  // Заказчик видит ответ исполнителя без контактов
  await loginAs(page, P.aigerim);
  await openMyRequest(page, 19);
  await page.getByRole("article", { name: "Исполнитель №3" }).getByRole("link", { name: /^Написать/ }).click();
  await expect(page.getByRole("log")).toContainText("Мой номер");
  await expectMasked(page);
});
