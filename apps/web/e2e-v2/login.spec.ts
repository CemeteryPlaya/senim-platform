import { expect, test, type Page } from "@playwright/test";
import { ru } from "@/i18n/ru";
import { freshPhone, open, readShownCode } from "./support";

/**
 * Вход в новом интерфейсе: роль → номер → код → первый обязательный шаг (согласие; пока на его месте заглушка раздела).
 * Номера каждый раз новые: identity стенда отвечает «слишком часто» на повтор кода раньше минуты и ограничивает новые номера
 * суточным потолком на префикс (первые 6 цифр) — случайные цифры разносят номера по префиксам. Сценарии создают
 * пользователей в identity стенда и в базе e2e; пересев не нужен. Подписи — только из ru.
 */

const t = ru.app.login;
const shell = ru.app.shell;

/** Ровно один `<h1>` и не больше одного главного действия на экране. */
async function expectScreenRules(page: Page) {
  await expect(page.locator("h1")).toHaveCount(1);
  expect(await page.locator("[data-primary-action]").count()).toBeLessThanOrEqual(1);
}

/** Адрес страницы ровно `path` (путь со строкой запроса) на любом хосте. */
const at = (path: string) => new RegExp(`^https?://[^/]+${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);

const heading = (page: Page, name: string) => page.getByRole("heading", { level: 1, name });
const primary = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

/** Шаг номера: номер → «Получить код» → шаг кода; код читается из сообщения на экране. */
async function requestCode(page: Page, phone: string): Promise<string> {
  await expect(heading(page, t.phone.title)).toBeVisible();
  await page.getByLabel(t.phone.label).fill(phone);
  await primary(page, t.phone.submit).click();
  await expect(heading(page, t.code.title)).toBeVisible();
  await expect(page).toHaveURL(/[?&]step=code/);
  await expectScreenRules(page);
  return readShownCode(page);
}

/** Вход новым номером с шага номера: код с экрана → «Войти». */
async function signInFromPhoneStep(page: Page, phone: string) {
  const code = await requestCode(page, phone);
  await page.getByLabel(t.code.label).fill(code);
  await primary(page, t.code.submit).click();
}

/**
 * Вошедший с непройденными первыми шагами видит сосредоточенную оболочку: в шапке «Выйти» и нет ни вкладок, ни «Войти»
 * (обычное меню вошедшего появляется после шагов — его проверяет onboarding.spec.ts).
 */
async function expectSignedIn(page: Page) {
  await expect(page.getByRole("button", { name: shell.logout, exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: shell.navLabel })).toHaveCount(0);
  await expect(page.getByRole("link", { name: shell.nav.login, exact: true })).toHaveCount(0);
}

test.beforeEach(async ({ context }) => {
  await context.clearCookies();
});

test("новый номер: роль → номер → код → согласие; вошедшего вход перенаправляет", async ({ page }) => {
  const phone = freshPhone();
  await open(page, "/v2/login");
  await expect(heading(page, t.role.title)).toBeVisible();
  await expect(page.getByText(ru.app.kit.wizard.step(1, 3))).toBeVisible();
  await expectScreenRules(page);
  // «Я покупатель» выбран сразу; в доке одна кнопка, «Уже есть аккаунт? Войти» — ссылка.
  await expect(page.getByRole("radio", { name: t.role.client })).toBeChecked();
  await expect(page.locator("[data-action-dock]").getByRole("link")).toHaveCount(0);
  await expect(page.locator("[data-action-dock]").getByRole("button")).toHaveCount(1);

  await page.getByText(t.role.executor, { exact: true }).click();
  await primary(page, t.role.submit).click();
  await expect(page).toHaveURL(/\/v2\/login\?step=phone$/);
  await expect(page.getByLabel(t.phone.label)).toBeFocused();
  await expectScreenRules(page);

  await signInFromPhoneStep(page, phone.typed);
  await expect(page).toHaveURL(/\/v2\/consent$/);
  await expectSignedIn(page);
  // Номер и код не попадали в адрес ни на одном шаге.
  expect(page.url()).not.toContain(phone.digits);

  // Вошедший на экране входа — сразу на следующий шаг.
  await open(page, "/v2/login");
  await expect(page).toHaveURL(/\/v2\/consent$/);
});

test("неверный код: ошибка у поля; «Изменить номер» возвращает к номеру, номер сохранён", async ({ page }) => {
  const phone = freshPhone();
  await open(page, "/v2/login");
  await page.getByRole("link", { name: t.role.haveAccount }).click();
  await expect(page).toHaveURL(/\/v2\/login\?step=phone$/);

  const code = await requestCode(page, phone.typed);
  const field = page.getByLabel(t.code.label);
  await field.fill(code === "000000" ? "111111" : "000000");
  await primary(page, t.code.submit).click();
  await expect(page.getByText(ru.identity.otp.errors.wrongCode(4))).toBeVisible();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(page).toHaveURL(/[?&]step=code/);

  // Повтор кода недоступен до конца отсчёта.
  await expect(page.getByRole("button", { name: new RegExp(`^${t.code.resend}`) })).toBeDisabled();

  await page.getByRole("link", { name: t.code.changePhone }).click();
  await expect(heading(page, t.phone.title)).toBeVisible();
  await expect(page).toHaveURL(/\/v2\/login\?step=phone$/);
  await expect(page.getByLabel(t.phone.label)).toHaveValue(phone.typed);
  expect(page.url()).not.toContain(phone.digits);

  // «Назад» браузера возвращает на шаг кода с тем же номером.
  await page.goBack();
  await expect(heading(page, t.code.title)).toBeVisible();
  await expect(page.getByText(t.code.sentTo(phone.typed))).toBeVisible();
});

test("перезагрузка шага кода без отправленного кода — шаг номера", async ({ page }) => {
  await open(page, "/v2/login?step=code");
  await expect(heading(page, t.phone.title)).toBeVisible();
  await expect(page).toHaveURL(/\/v2\/login\?step=phone$/);
});

test("next на адрес v2 переносится через вход на первый шаг; чужой next отбрасывается", async ({ page, context }) => {
  const next = "/v2/about";
  await open(page, `/v2/login?${new URLSearchParams({ next })}`);
  await primary(page, t.role.submit).click();
  await expect(page).toHaveURL(at(`/v2/login?${new URLSearchParams({ step: "phone", next })}`));
  await signInFromPhoneStep(page, freshPhone().typed);
  await expect(page).toHaveURL(at(`/v2/consent?${new URLSearchParams({ next })}`));

  // Вошедший с безопасным next — тоже туда (через первый обязательный шаг).
  await open(page, `/v2/login?${new URLSearchParams({ next })}`);
  await expect(page).toHaveURL(at(`/v2/consent?${new URLSearchParams({ next })}`));

  await context.clearCookies();
  await open(page, `/v2/login?${new URLSearchParams({ step: "phone", next: "https://evil.example/v2" })}`);
  await signInFromPhoneStep(page, freshPhone().typed);
  await expect(page).toHaveURL(/\/v2\/consent$/);
});

test("выбор запоминается: вернувшись к первому шагу, видишь «Я мастер»", async ({ page }) => {
  await open(page, "/v2/login");
  await page.getByText(t.role.executor, { exact: true }).click();
  await primary(page, t.role.submit).click();
  await expect(heading(page, t.phone.title)).toBeVisible();
  await page.getByRole("link", { name: `${ru.app.kit.back}: ${t.phone.backLabel}` }).click();
  await expect(heading(page, t.role.title)).toBeVisible();
  await expect(page.getByRole("radio", { name: t.role.executor })).toBeChecked();
  // Новая загрузка страницы — выбор из cookie.
  await open(page, "/v2/login");
  await expect(page.getByRole("radio", { name: t.role.executor })).toBeChecked();
});

test("выход ведёт на вход v2", async ({ page }) => {
  await open(page, "/v2/login?step=phone");
  await signInFromPhoneStep(page, freshPhone().typed);
  await expectSignedIn(page);

  await page.getByRole("button", { name: shell.logout, exact: true }).click();
  await expect(page).toHaveURL(/\/v2\/login$/);
  await expect(heading(page, t.role.title)).toBeVisible();
});
