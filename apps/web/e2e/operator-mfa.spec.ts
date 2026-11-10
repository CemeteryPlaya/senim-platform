import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { confirmOperation, loginByPhone, reseed } from "./support";
import { totpNow } from "./totp";

/**
 * Вторая ступень входа оператора (TOTP, план 2б): не-демо оператор входит по SMS-коду, попадает на /operator/mfa,
 * подключает приложение (секрет со страницы → код RFC 6238 из e2e/totp.ts) и оказывается в кабинете. Сразу после
 * проверки действие с деньгами (подтверждение оплаты сделки №3, manual) проходит без повторного кода.
 * Граница «через 5 минут код спрашивается снова» — в vitest (requireRecentMfa): часы Playwright не двигают часы сервера.
 */

/** Номер не из демо-данных (src/demo/data.ts): оператор без демо-входа. */
const OPERATOR_PHONE = "+77000000901";

/** Завести не-демо оператора в identity стенда (SeedUsers, is_demo=false) — тем же путём, что и сид. */
function seedOperator(phone: string): void {
  const url = process.env.E2E_DATABASE_URL ?? "";
  if (!/e2e/i.test(new URL(url).pathname)) throw new Error("E2E_DATABASE_URL должна указывать на базу с «e2e» в имени");
  execFileSync(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), "--import", "./scripts/server-only-hook.mjs", "e2e/seed-operator.ts", phone], {
    env: { ...process.env, DATABASE_URL: url, DEMO_MODE: "true" },
    stdio: "pipe",
    // Зависший вызов identity не должен держать прогон до общего тайм-аута.
    timeout: 60_000,
  });
}

test.beforeAll(() => {
  test.setTimeout(120_000);
  // Сид сбрасывает identity стенда (ResetDemo стирает и факторы TOTP): каждый прогон подключает приложение заново.
  reseed();
  seedOperator(OPERATOR_PHONE);
});

test("не-демо оператор: SMS → подключение приложения → кабинет → действие с деньгами", async ({ page }) => {
  await loginByPhone(page, OPERATOR_PHONE);
  // Кабинет без второй ступени не открывается: экран кода с возвратом в кабинет.
  await expect(page).toHaveURL(/\/operator\/mfa\?next=%2Foperator$/);
  await expect(page.getByRole("heading", { level: 1, name: "Подключите приложение для входа" })).toBeVisible();
  await expect(page.getByRole("img", { name: /QR-код для подключения/ })).toBeVisible();

  const secret = await page.getByLabel("Ключ для ввода вручную").inputValue();
  expect(secret.replace(/\s/g, "")).toMatch(/^[A-Z2-7]{32}$/);
  await page.getByLabel("Код из приложения").fill(totpNow(secret));
  await page.getByRole("button", { name: "Подключить и войти" }).click();
  await expect(page).toHaveURL(/\/operator$/);

  // Код только что пройден: подтверждение операции банка идёт без повторного кода.
  await confirmOperation(page, { type: "Оплата покупателя на эскроу-счёт", deal: 3, confirm: "Деньги поступили на счёт в банке", docNumber: "E2E-MFA-1" });
  await expect(page.getByLabel("Код из приложения")).toHaveCount(0);
});
