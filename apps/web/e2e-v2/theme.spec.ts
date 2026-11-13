import { expect, test } from "@playwright/test";
import { ru } from "@/i18n/ru";
import { freshPhone, loginV2, open, passOnboarding } from "./support";

/**
 * Тема интерфейса: гость переключает её внизу «О сервисе» (раздел «Оформление»), вошедший на компьютере — в меню профиля.
 * Тема — кука `theme` и `data-theme` на <html>; «Авто» снимает атрибут. После перезагрузки выбор сохраняется, без мигания
 * (сервер отдаёт страницу сразу в нужной теме). Переключатель без JavaScript — fixme в foundation.spec.ts (заголовок
 * Referrer-Policy), здесь не повторяется.
 */

const theme = ru.app.shell.theme;
const shell = ru.app.shell;

test("гость: «Оформление» внизу «О сервисе» — «Тёмная» ставит data-theme и переживает перезагрузку, «Авто» снимает", async ({ page, context }) => {
  await context.clearCookies();
  await open(page, "/v2/about");
  const html = page.locator("html");
  await expect(page.getByRole("heading", { level: 2, name: theme.section })).toBeVisible();
  const dark = page.getByRole("button", { name: theme.dark, exact: true });
  const auto = page.getByRole("button", { name: theme.system, exact: true });

  await dark.click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(dark).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(dark).toHaveAttribute("aria-pressed", "true");

  await auto.click();
  await expect(html).not.toHaveAttribute("data-theme");
  await expect(auto).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(html).not.toHaveAttribute("data-theme");
});

test("вошедший на компьютере: тема переключается из меню профиля и сохраняется", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "меню профиля — только компьютер; на телефоне переключатель — на странице профиля");
  await loginV2(page, freshPhone().typed);
  await passOnboarding(page);
  await expect(page).toHaveURL(/\/v2$/);
  const html = page.locator("html");

  await page.getByRole("button", { name: shell.profileMenu }).click();
  await page.getByRole("menuitemradio", { name: theme.dark, exact: true }).click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark");

  await page.getByRole("button", { name: shell.profileMenu }).click();
  await expect(page.getByRole("menuitemradio", { name: theme.dark, exact: true })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("menuitemradio", { name: theme.system, exact: true }).click();
  await expect(html).not.toHaveAttribute("data-theme");
  await page.reload();
  await expect(html).not.toHaveAttribute("data-theme");
});

test("вошедший: колокольчик уведомлений — в шапке компьютера и в верхней строке корневого экрана на телефоне", async ({ page }, info) => {
  await loginV2(page, freshPhone().typed);
  await passOnboarding(page);
  await expect(page).toHaveURL(/\/v2$/);
  const bell = page.getByRole("link", { name: new RegExp(`^${shell.notifications}`) });
  await expect(bell).toHaveCount(1);
  await expect(bell).toBeVisible();
  const inside = info.project.name === "mobile" ? page.locator("[data-top-strip]") : page.locator("[data-top-bar]");
  await expect(inside.getByRole("link", { name: new RegExp(`^${shell.notifications}`) })).toBeVisible();
  await bell.click();
  await expect(page).toHaveURL(/\/v2\/notifications/);
  // Вложенный экран: верхней строки с колокольчиком на телефоне нет.
  if (info.project.name === "mobile") await expect(page.locator("[data-top-strip]")).toHaveCount(0);
});

test("вошедший на компьютере: тема переключается с клавиатуры (стрелки и Enter в меню профиля)", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "меню профиля — только компьютер");
  await loginV2(page, freshPhone().typed);
  await passOnboarding(page);
  const trigger = page.getByRole("button", { name: shell.profileMenu });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dark = page.getByRole("menuitemradio", { name: theme.dark, exact: true });
  await expect(dark).toBeVisible();
  // Стрелка вниз идёт по пунктам: Профиль, Авто, Светлая, Тёмная.
  for (let step = 0; step < 6 && !(await dark.evaluate((el) => el === document.activeElement)); step += 1) {
    await page.keyboard.press("ArrowDown");
  }
  await expect(dark).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
