import { expect, test, type Page } from "@playwright/test";
import { loginAs, openDeal, openMyRequest, P, reseed } from "./support";

/**
 * Контакты до оферты (ТЗ п. 3, ADR-009 раздел 7). Тендер №18 сида: чат Айгерим ↔ Исполнитель №3 (Ерлан) —
 * телефоны, ссылки на мессенджеры и e-mail маскируются до сохранения, их не видит ни одна сторона.
 * После заключения оферты (сделка №2: Мадина ↔ ТОО «Qazaq Wood») контакты обеих сторон видны.
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
  for (const leak of LEAKS) await expect(log).not.toContainText(leak);
}

test("до оферты контакты в сообщениях скрываются у обеих сторон", async ({ page }) => {
  await loginAs(page, P.aigerim);
  await openMyRequest(page, 18);
  await page.getByRole("article", { name: "Исполнитель №3" }).getByRole("link", { name: /^Подробнее/ }).click();
  await expect(page.getByRole("heading", { name: "Написать Исполнителю №3" })).toBeVisible();
  await send(page, FROM_CLIENT);
  await expect(page.getByRole("log").getByRole("listitem").last()).toContainText("Позвоните мне:");
  await expectMasked(page);

  // Мастер видит сообщение уже замаскированным и отвечает своими контактами
  await loginAs(page, P.erlan);
  await page.goto("/executor/requests");
  await page.getByRole("link", { name: /^Заявка №18:/ }).first().click();
  await expect(page.getByRole("heading", { name: "Чат с заказчиком" })).toBeVisible();
  await expect(page.getByRole("log")).toContainText("Позвоните мне:");
  await expectMasked(page);
  await send(page, FROM_EXECUTOR);
  await expect(page.getByRole("log").getByRole("listitem").last()).toContainText("Мой номер");
  await expectMasked(page);
  // Телефона покупателя на экране мастера нет
  await expect(page.getByRole("main")).not.toContainText(/700\s*000\s*01\s*01/);

  // Покупатель видит ответ мастера без контактов
  await loginAs(page, P.aigerim);
  await openMyRequest(page, 18);
  await page.getByRole("article", { name: "Исполнитель №3" }).getByRole("link", { name: /^Подробнее/ }).click();
  await expect(page.getByRole("log")).toContainText("Мой номер");
  await expectMasked(page);
  await expect(page.getByRole("main")).not.toContainText(/700\s*000\s*02\s*01/);
});

test("после оферты контакты видны обеим сторонам сделки", async ({ page }) => {
  await loginAs(page, P.madina);
  await openDeal(page, 2);
  // Блок контактов на экране сделки (второй такой же — компактный, в чате)
  const executorContacts = page.getByRole("region", { name: "Контакты исполнителя" }).first();
  await expect(executorContacts).toContainText("Оферта заключена — теперь вы видите контакты друг друга");
  await expect(executorContacts).toContainText(/700\s*000\s*02\s*06/);

  await loginAs(page, P.qazaq);
  await openDeal(page, 2);
  await expect(page.getByRole("region", { name: "Контакты заказчика" }).first()).toContainText(/700\s*000\s*01\s*03/);
});
