import { expect, test, type Page } from "@playwright/test";
import { PHONE } from "./support";

/**
 * Вход по SMS-коду (SMS_PROVIDER=mock показывает код в демо-баннере).
 * Данные не меняются, кроме кодов и сессий, поэтому пересев не нужен. Номер повторно
 * получает код только через минуту — у каждого проекта (mobile/desktop) свои номера.
 */

const PHONES = {
  mobile: { ok: PHONE.madina, home: /\/requests$/, heading: "Мои заявки", wrong: PHONE.daniyar },
  desktop: { ok: PHONE.samat, home: /\/executor\/requests$/, heading: "Заявки", wrong: PHONE.timur },
} as const;

function phonesFor(project: string) {
  return project === "desktop" ? PHONES.desktop : PHONES.mobile;
}

/** Номер → «Получить код» → код из демо-баннера. */
async function requestCode(page: Page, phone: string): Promise<string> {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Номер телефона").fill(phone);
  await page.getByRole("button", { name: "Получить код" }).click();
  await expect(page.getByRole("heading", { name: "Введите код из SMS" })).toBeVisible();
  await expect(page.getByLabel("Код из SMS")).toBeFocused();
  const banner = page.getByText(/Демо-режим: SMS не отправляется\. Ваш код — \d{6}/);
  await expect(banner).toBeVisible();
  const code = (await banner.textContent())?.match(/\d{6}/)?.[0];
  if (!code) throw new Error("Код не найден в демо-баннере");
  return code;
}

test("вход по коду из SMS ведёт на главную роли", async ({ page }, info) => {
  const p = phonesFor(info.project.name);
  const code = await requestCode(page, p.ok);
  await page.getByLabel("Код из SMS").fill(code);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.waitForURL(p.home);
  await expect(page.getByRole("heading", { level: 1, name: p.heading, exact: true })).toBeVisible();
});

test("неверный код — понятная ошибка у поля, вход не выполнен", async ({ page }, info) => {
  const p = phonesFor(info.project.name);
  const code = await requestCode(page, p.wrong);
  const wrong = code === "000000" ? "111111" : "000000";
  const field = page.getByLabel("Код из SMS");
  await field.fill(wrong);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page.getByText("Неверный код. Осталось попыток: 4")).toBeVisible();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(page).toHaveURL(/\/login/);
});

test("неверный номер — ошибка у поля номера", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/login");
  const field = page.getByLabel("Номер телефона");
  await field.fill("12345");
  await page.getByRole("button", { name: "Получить код" }).click();
  await expect(page.getByText("Введите казахстанский мобильный номер: +7 7XX XXX XX XX")).toBeVisible();
  await expect(field).toHaveAttribute("aria-invalid", "true");
});
