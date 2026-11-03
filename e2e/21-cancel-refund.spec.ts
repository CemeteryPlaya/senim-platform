import { expect, test } from "@playwright/test";
import { bankBalance, pdfText } from "./pdf-text";
import { amount, dealMoney, expectDealStatus, historyRow, loginAs, moneyBlock, nextStep, openDeal, openMoneyHistory, P, reseed } from "./support";

/**
 * Критерий ТЗ 2: отмена до IN_PROGRESS с полным возвратом. Сделка №4 сида — PAID_HOLD, mock-провайдер,
 * Айгерим ↔ Тимур (Исп. №6), шкаф 290 000 ₸: оплачено 295 800 ₸ (с защитой 2%). Отмена покупателем —
 * REFUNDED и возврат всей оплаченной суммы, включая 2%. Плюс отмена до оплаты (№2, CREATED) — без денег.
 */

const PAID = dealMoney(290_000);

test.describe.configure({ mode: "serial" });
test.beforeAll(() => {
  test.setTimeout(120_000);
  reseed();
});

test("после оплаты мастер отменить не может — только спор", async ({ page }) => {
  await loginAs(page, P.timur);
  await openDeal(page, 4);
  await expectDealStatus(page, "Оплачено, ждёт начала работ");
  await expect(page.getByRole("button", { name: "Отменить сделку" })).toHaveCount(0);
  await expect(page.locator("summary", { hasText: "Открыть спор" })).toBeVisible();
});

test("покупатель отменяет оплаченную сделку: REFUNDED, возврат всего оплаченного, одна операция", async ({ page }) => {
  expect(PAID.buyerTotal).toBe(29_580_000n);
  await loginAs(page, P.aigerim);
  const dealPath = await openDeal(page, 4);
  await expect(moneyBlock(page)).toContainText(amount(PAID.buyerTotal));

  await page.getByRole("button", { name: "Отменить сделку" }).click();
  const dialog = page.getByRole("dialog", { name: "Отменить сделку?" });
  await expect(dialog).toContainText("Деньги вернутся на вашу карту.");
  await dialog.getByRole("button", { name: "Да, отменить" }).dblclick(); // двойной клик — один возврат
  await expect(dialog).toBeHidden();
  await expectDealStatus(page, "Деньги возвращены"); // экран обновился после ответа сервера

  await page.goto(dealPath);
  await expectDealStatus(page, "Деньги возвращены");
  await expect(moneyBlock(page)).toContainText("Деньги вернулись покупателю");
  await expect(moneyBlock(page)).toContainText(amount(PAID.buyerTotal));
  await expect(nextStep(page)).toContainText("Деньги возвращены покупателю");
  await expect(page.getByRole("button", { name: "Отменить сделку" })).toHaveCount(0);

  const rows = await openMoneyHistory(page, dealPath);
  await expect(historyRow(rows, "Деньги зарезервированы в банке")).toContainText(amount(PAID.buyerTotal));
  await expect(historyRow(rows, "Возвращено покупателю")).toHaveCount(1);
  await expect(historyRow(rows, "Возвращено покупателю")).toContainText(amount(PAID.buyerTotal));
  await expect(historyRow(rows, "Выплачено мастеру")).toHaveCount(0);

  // Выписка PDF — та же сумма возврата
  const href = await page.getByRole("link", { name: "Выписка по сделке (PDF)" }).getAttribute("href");
  const res = await page.request.get(href ?? "");
  expect(res.status()).toBe(200);
  const text = await pdfText(await res.body());
  const operations = text.slice(text.lastIndexOf("Операции"));
  expect(operations).toMatch(/Возврат/);
  expect(operations).toMatch(amount(PAID.buyerTotal));
  expect(bankBalance(operations)).toMatch(amount(0n));

  await loginAs(page, P.timur);
  await page.goto(dealPath);
  await expectDealStatus(page, "Деньги возвращены");
  await expect(moneyBlock(page)).toContainText(amount(PAID.buyerTotal));
});

test("отмена до оплаты: CANCELLED, движений денег нет", async ({ page }) => {
  await loginAs(page, P.madina);
  const dealPath = await openDeal(page, 2);
  await expectDealStatus(page, "Оферта: подпись и оплата");
  await page.getByRole("button", { name: "Отменить сделку" }).click();
  const dialog = page.getByRole("dialog", { name: "Отменить сделку?" });
  await expect(dialog).toContainText("Оферта не будет исполняться.");
  await dialog.getByRole("button", { name: "Да, отменить" }).click();
  await expect(dialog).toBeHidden();
  await expectDealStatus(page, "Отменена");
  await page.goto(dealPath);
  await expectDealStatus(page, "Отменена");
  await expect(nextStep(page)).toContainText("Сделка отменена");
  await expect(nextStep(page).getByRole("button")).toHaveCount(0);
  await openMoneyHistory(page, dealPath);
  await expect(page.getByText("Движений денег пока нет.")).toBeVisible();
});
