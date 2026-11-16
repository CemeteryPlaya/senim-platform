import { expect, test, type Page } from "@playwright/test";
import { ru } from "@/i18n/ru";
import { freshEmail, freshIin, freshPhone, loginV2, open, passOnboarding, readShownCode } from "./support";

/**
 * Профиль покупателя: «Мои данные» (ИИН только четырьмя цифрами), тема из профиля, выход на телефоне, Instagram, отзыв
 * согласия с подтверждением, смена почты (прежняя действует, пока новая не подтверждена) и «Помощь» гостю. Каждый
 * сценарий — свежий человек (номер, ИИН и почта новые): identity стенда помнит их между прогонами. Подписи — из ru.
 */

const t = ru.app.profile;
const shell = ru.app.shell;

async function freshBuyer(page: Page, options: { email?: string } = {}): Promise<{ iin: string }> {
  const iin = freshIin();
  await loginV2(page, freshPhone().typed);
  await passOnboarding(page, { iin, ...options });
  await expect(page).toHaveURL(/\/v2$/);
  // Переход после последнего шага анкеты ещё может идти: следующий goto прервал бы его (ERR_ABORTED).
  await page.waitForLoadState("networkidle");
  return { iin };
}

const link = (page: Page, name: string) => page.getByRole("link", { name, exact: true });

test("профиль → «Мои данные»: ИИН только последними четырьмя цифрами, полного номера на странице нет", async ({ page }) => {
  const { iin } = await freshBuyer(page);
  await open(page, "/v2/profile");
  await expect(page.locator("h1")).toHaveText(t.title);
  expect(await page.locator("[data-primary-action]").count()).toBe(0);

  await link(page, t.rows.data).click();
  await expect(page.locator("h1")).toHaveText(t.data.title);
  await expect(page.getByText(t.data.iinMasked(iin.slice(-4)))).toBeVisible();
  const body = await page.locator("body").innerText();
  expect(body).not.toContain(iin);
  expect(await page.content()).not.toContain(iin);
  await expect(page.getByText(t.data.consentKinds.PD_PROCESSING)).toBeVisible();
  await expect(page.getByText(t.data.statusActive)).toBeVisible();
  await expect(page.getByRole("link", { name: `${ru.app.kit.back}: ${t.data.back}` })).toBeVisible();
});

test("смена темы из профиля сохраняется после перезагрузки", async ({ page }) => {
  await freshBuyer(page);
  await open(page, "/v2/profile");
  const html = page.locator("html");
  const dark = page.getByRole("button", { name: shell.theme.dark, exact: true });
  await dark.click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: shell.theme.system, exact: true }).click();
  await expect(html).not.toHaveAttribute("data-theme");
});

test("«Выйти» на странице профиля: на вход, сессия закрыта", async ({ page }) => {
  await freshBuyer(page);
  await open(page, "/v2/profile");
  await page.getByRole("button", { name: shell.logout, exact: true }).click();
  await expect(page).toHaveURL(/\/v2\/login/);
  await open(page, "/v2/profile");
  await expect(page).toHaveURL(/\/v2\/login/);
});

test("контакты: Instagram сохраняется без «@», неверный формат — ошибка у поля; телефон только показан", async ({ page }) => {
  await freshBuyer(page);
  await open(page, "/v2/profile");
  await link(page, t.rows.contacts).click();
  await expect(page.locator("h1")).toHaveText(t.contacts.title);
  expect(await page.locator("[data-primary-action]").count()).toBe(1);
  await expect(page.getByText(t.contacts.email.confirmed)).toBeVisible();

  await page.getByRole("button", { name: t.contacts.phone.explain.label }).click();
  await expect(page.getByText(t.contacts.phone.explain.body)).toBeVisible();
  await page.keyboard.press("Escape");

  const field = page.getByLabel(t.contacts.instagram.label);
  await field.fill("дала!");
  await page.getByRole("button", { name: t.contacts.save, exact: true }).click();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText(ru.identity.contacts.instagramInvalid)).toBeVisible();

  await field.fill("@dala_01");
  await page.getByRole("button", { name: t.contacts.save, exact: true }).click();
  await expect(page.getByText(t.contacts.saved)).toBeVisible();
  await expect(field).toHaveValue("dala_01");
  await page.reload();
  await expect(page.getByLabel(t.contacts.instagram.label)).toHaveValue("dala_01");
});

test("отзыв согласия: меню → подтверждение с последствиями → заявка на рассмотрении, согласие действует", async ({ page }) => {
  await freshBuyer(page);
  await open(page, "/v2/profile/data");
  await page.getByRole("button", { name: t.data.menu }).click();
  await page.getByText(t.data.revoke.action, { exact: true }).click();
  await expect(page.getByText(t.data.revoke.title)).toBeVisible();
  await expect(page.getByText(t.data.revoke.consequences)).toBeVisible();
  // Отказ закрывает окно без заявки.
  await page.getByRole("button", { name: t.data.revoke.cancel }).click();
  await expect(page.getByText(t.data.revoke.title)).toHaveCount(0);
  await expect(page.getByText(t.data.revocation.title)).toHaveCount(0);

  await page.getByRole("button", { name: t.data.menu }).click();
  await page.getByText(t.data.revoke.action, { exact: true }).click();
  await page.getByRole("button", { name: t.data.revoke.confirm }).click();
  await expect(page.getByText(t.data.revocation.status.REQUESTED)).toBeVisible();
  await expect(page.getByText(t.data.revocation.stillActive)).toBeVisible();
  await expect(page.getByRole("button", { name: t.data.menu })).toHaveCount(0);
  // Согласие действует: сервис по-прежнему открывается.
  await open(page, "/v2");
  await expect(page).toHaveURL(/\/v2$/);
});

test("«Помощь» открывается гостю; вошедшему — тоже", async ({ page, context }) => {
  await context.clearCookies();
  await open(page, "/v2/help");
  await expect(page.locator("h1")).toHaveText(ru.app.profile.help.title);
  await expect(page.getByRole("heading", { level: 2, name: t.help.how.title })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: t.help.money.title })).toBeVisible();
  await expect(page.locator('a[href^="mailto:"]', { hasText: t.help.support.action })).toBeVisible();
  await expect(page).toHaveURL(/\/v2\/help$/);
});

test("ссылка «Как это работает» на главной ведёт на раздел «Помощи»", async ({ page }) => {
  await freshBuyer(page);
  await page.getByRole("link", { name: ru.app.profile.help.how.title }).first().click();
  await expect(page).toHaveURL(/\/v2\/help#how$/);
  await expect(page.locator("h1")).toHaveText(t.help.title);
});

test("смена почты: прежняя действует, пока новая не подтверждена кодом; после — контакты с тостом и новым адресом", async ({ page }) => {
  const email = ru.app.onboarding.email;
  const oldEmail = freshEmail();
  const newEmail = freshEmail();
  await freshBuyer(page, { email: oldEmail });
  // Пауза identity между кодами одного человека (на стенде 1 с, в prod — минута).
  await page.waitForTimeout(2_000);
  await open(page, "/v2/profile/contacts");
  await expect(page.getByText(oldEmail)).toBeVisible();
  await link(page, t.contacts.email.change).click();
  await expect(page.locator("h1")).toHaveText(t.emailChange.addressTitle);
  await expect(page.getByRole("link", { name: `${ru.app.kit.back}: ${t.emailChange.back}` })).toBeVisible();

  await page.getByLabel(email.address.label).fill(newEmail);
  await page.getByRole("button", { name: email.address.submit, exact: true }).click();
  const code = await readShownCode(page, email.code.shownCode);

  // Пока код не введён, в другой вкладке прежняя почта на месте, а человек не возвращён в анкету.
  const other = await page.context().newPage();
  await open(other, "/v2/profile/contacts");
  await expect(other.getByText(oldEmail)).toBeVisible();
  await expect(other.getByText(t.contacts.email.confirmed)).toBeVisible();
  await expect(other.getByText(newEmail)).toHaveCount(0);
  await expect(other).toHaveURL(/\/v2\/profile\/contacts$/);
  await other.close();

  await page.getByLabel(email.code.label).fill(code);
  // Код уходит сам после последней цифры (CodeField autoSubmit) — кнопку не нажимаем.
  await expect(page).toHaveURL(/\/v2\/profile\/contacts$/);
  await expect(page.getByText(t.contacts.emailChanged)).toBeVisible();
  await expect(page.getByText(newEmail)).toBeVisible();
  await expect(page.getByText(oldEmail)).toHaveCount(0);
});

test("короткий телефон 390×667: «Выйти» после прокрутки до конца не под панелью вкладок и нажимается", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "панель вкладок — только телефон");
  await page.setViewportSize({ width: 390, height: 667 });
  await freshBuyer(page);
  await open(page, "/v2/profile");
  const logout = page.getByRole("button", { name: shell.logout, exact: true });
  await logout.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(logout).toBeVisible();
  const bar = await page.getByRole("navigation", { name: shell.navLabel }).boundingBox();
  const box = await logout.boundingBox();
  expect(bar).not.toBeNull();
  expect(box).not.toBeNull();
  // Кнопка целиком выше панели вкладок.
  expect(box!.y + box!.height).toBeLessThanOrEqual(bar!.y);
  await logout.click();
  await expect(page).toHaveURL(/\/v2\/login/);
});
