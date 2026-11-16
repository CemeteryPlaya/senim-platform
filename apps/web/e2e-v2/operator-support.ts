import { expect, type Page } from "@playwright/test";
import { ru } from "@/i18n/ru";
import { scanPdf } from "../e2e/support";
import { TOTP_PERIOD_S, totpNow } from "../e2e/totp";
import { open } from "./support";

// Оператор в сценариях v2: второй шаг входа и подтверждение денег в очереди v2. Отдельно от support.ts: тот импортирует и
// скрипт снимков вне Playwright Test.
/**
 * Второй шаг входа оператора в v2 (`/v2/operator/mfa`): код из приложения по секрету стенда. Один код принимается один раз:
 * если шаг уже занят прошлым входом, ждём следующий (30 с) и вводим заново. Код уходит сам после последней цифры.
 */
export async function passOperatorTotpV2(page: Page, secret: string): Promise<void> {
  const label = ru.app.operator.mfa.codeLabel;
  await expect(page).toHaveURL(/\/v2\/operator\/mfa/);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.getByLabel(label).fill(totpNow(secret));
    const left = await page.waitForURL((u) => !u.pathname.startsWith("/v2/operator/mfa"), { timeout: 10_000 }).then(
      () => true,
      () => false,
    );
    if (left) return;
    await page.waitForTimeout((TOTP_PERIOD_S - ((Date.now() / 1000) % TOTP_PERIOD_S) + 1) * 1000);
    await page.getByLabel(label).clear();
  }
  throw new Error("Оператор не прошёл второй шаг входа в v2");
}

/**
 * Оператор подтверждает операцию в очереди v2 (`/v2/operator/money`): номер и скан документа банка (дата — сегодня по
 * умолчанию), кнопка с тем, что сделал банк. Ждёт объявления итога и ухода карточки из очереди.
 */
export async function confirmOperationV2(page: Page, o: { type: ManualType; deal: number; docNumber: string; totpSecret?: string }): Promise<void> {
  const q = ru.app.operatorQueues.money;
  await open(page, "/v2/operator/money");
  const card = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: q.types[o.type], exact: true }) })
    .filter({ has: page.getByRole("link", { name: new RegExp(`^Сделка №${o.deal}:`) }) });
  await expect(card).toHaveCount(1);
  await card.getByLabel(q.bankDocNumber).fill(o.docNumber);
  await card.locator('input[type="file"]').setInputFiles({ name: `${o.docNumber}.pdf`, mimeType: "application/pdf", buffer: await scanPdf() });
  const button = card.getByRole("button", { name: q.confirm[o.type], exact: true });
  await button.click();
  // Код из приложения вводили больше 5 минут назад — форма просит его над кнопкой и повторяет подтверждение с тем же сканом.
  const done = page.getByRole("status").filter({ hasText: q.confirmed });
  const code = card.getByLabel(ru.app.operator.secondFactor.label);
  await expect(done.or(code)).toBeVisible();
  if (await code.isVisible()) {
    if (!o.totpSecret) throw new Error("Сервер просит код из приложения: передайте totpSecret");
    await code.fill(totpNow(o.totpSecret));
    await button.click();
  }
  await expect(done).toBeVisible();
  await expect(card).toHaveCount(0);
}

type ManualType = keyof typeof ru.app.operatorQueues.money.confirm;
