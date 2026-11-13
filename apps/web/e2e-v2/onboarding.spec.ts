import { expect, test, type Page } from "@playwright/test";
import { ru } from "@/i18n/ru";
import { CONSENT_DOCUMENTS } from "@/i18n/ru/consent";
import { freshIin, freshPhone, open, readShownCode } from "./support";

/**
 * Первые шаги после входа в новом интерфейсе: согласие на обработку данных → ФИО и ИИН (→ подтверждение почты, пока на его
 * месте заглушка раздела). Вход новым номером через код с экрана (номера и ИИН каждый раз новые: identity стенда помнит их
 * между прогонами). Подписи — только из ru; на каждом экране ровно один h1 и не больше одного главного действия.
 */

const login = ru.app.login;
const consent = ru.app.onboarding.consent;
const welcome = ru.app.onboarding.welcome;
const identityTexts = ru.identity.clientIdentity;
const shell = ru.app.shell;
const doc = CONSENT_DOCUMENTS.PD_PROCESSING;

/** Ровно один `<h1>` и не больше одного главного действия на экране. */
async function expectScreenRules(page: Page) {
  await expect(page.locator("h1")).toHaveCount(1);
  expect(
    await page.locator("[data-primary-action]").count(),
  ).toBeLessThanOrEqual(1);
}

const heading = (page: Page, name: string) =>
  page.getByRole("heading", { level: 1, name });
const primary = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });

/** Вход новым номером с шага номера: код с экрана → «Войти». Заканчивается на экране согласия. */
async function signInNewcomer(page: Page, path = "/v2/login?step=phone") {
  await open(page, path);
  await page.getByLabel(login.phone.label).fill(freshPhone().typed);
  await primary(page, login.phone.submit).click();
  const code = await readShownCode(page);
  await page.getByLabel(login.code.label).fill(code);
  await primary(page, login.code.submit).click();
  await page.waitForURL(/\/v2\/consent/);
  await page.waitForLoadState("networkidle");
}

test.beforeEach(async ({ context }) => {
  await context.clearCookies();
});

test("новый номер: согласие → знакомство → почта; ошибки у полей, введённое не теряется", async ({
  page,
}) => {
  await signInNewcomer(page);

  // Согласие: шаг 1 из 3, текст целиком в области прокрутки, одна главная кнопка.
  await expect(heading(page, consent.title)).toBeVisible();
  await expect(page.getByText(ru.app.kit.wizard.step(1, 3))).toBeVisible();
  await expectScreenRules(page);
  const text = page.getByRole("region", { name: consent.textLabel });
  await expect(text).toContainText(doc.sections[0].heading);
  await expect(text).toHaveAttribute("tabindex", "0");
  await expect(page.getByText(doc.draft)).toBeVisible();

  // Без отметки — ошибка у поля, дальше не уходим.
  await primary(page, consent.submit).click();
  await expect(page.getByText(consent.errors.required)).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: consent.agree }),
  ).toHaveAttribute("aria-invalid", "true");
  await expect(page).toHaveURL(/\/v2\/consent$/);

  // С отметкой — знакомство: шаг пересчитан по оставшемуся.
  await page.getByText(consent.agree, { exact: true }).click();
  await primary(page, consent.submit).click();
  await expect(heading(page, welcome.title)).toBeVisible();
  await expect(page).toHaveURL(/\/v2\/welcome$/);
  await expect(page.getByText(ru.app.kit.wizard.step(2, 3))).toBeVisible();
  await expectScreenRules(page);

  // Пустые поля — обе ошибки сразу у полей.
  await primary(page, welcome.submit).click();
  await expect(page.getByText(welcome.errors.fullNameRequired)).toBeVisible();
  await expect(page.getByText(welcome.errors.iinRequired)).toBeVisible();
  await expect(page.getByLabel(welcome.fullName)).toHaveAttribute(
    "aria-invalid",
    "true",
  );

  // Неверный ИИН — отказ identity у поля ИИН; ФИО остаётся.
  await page.getByLabel(welcome.fullName).fill("Сапаров Ерлан");
  await page.getByLabel(welcome.iin).fill("123");
  await primary(page, welcome.submit).click();
  await expect(page.getByText(identityTexts.iinInvalid)).toBeVisible();
  await expect(page.getByLabel(welcome.fullName)).toHaveValue("Сапаров Ерлан");
  await expect(page.getByLabel(welcome.iin)).toHaveAttribute(
    "aria-invalid",
    "true",
  );

  // «Зачем ИИН» — по нажатию (телефон — шторка, компьютер — поповер).
  await page.getByRole("button", { name: welcome.explain.label }).click();
  await expect(page.getByText(welcome.explain.body)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText(welcome.explain.body)).toHaveCount(0);

  // Верный ИИН — следующий шаг (почта; пока заглушка раздела). Вернуться на знакомство нельзя: шаг пройден.
  await page.getByLabel(welcome.iin).fill(freshIin());
  await primary(page, welcome.submit).click();
  await expect(page).toHaveURL(/\/v2\/email$/);
  await open(page, "/v2/welcome");
  await expect(page).toHaveURL(/\/v2\/email$/);
  await open(page, "/v2/consent");
  await expect(page).toHaveURL(/\/v2\/email$/);
});

test("next проходит через все шаги; после согласия страница знакомства ведёт дальше, а не по кругу", async ({
  page,
}) => {
  const next = "/v2/about";
  await signInNewcomer(
    page,
    `/v2/login?${new URLSearchParams({ step: "phone", next })}`,
  );
  await expect(page).toHaveURL(
    new RegExp(`/v2/consent\\?next=${encodeURIComponent(next)}$`),
  );

  await page.getByText(consent.agree, { exact: true }).click();
  await primary(page, consent.submit).click();
  await expect(page).toHaveURL(
    new RegExp(`/v2/welcome\\?next=${encodeURIComponent(next)}$`),
  );

  // Знакомство до согласия не открыть — а после согласия оно открыто, согласие же ведёт на него.
  await open(page, `/v2/consent?next=${encodeURIComponent(next)}`);
  await expect(page).toHaveURL(
    new RegExp(`/v2/welcome\\?next=${encodeURIComponent(next)}$`),
  );
});

test("гость на шагах — на вход; на шагах сосредоточенная оболочка, «Выйти» в шапке ведёт на вход", async ({ page }) => {
  await open(page, "/v2/consent");
  await expect(page).toHaveURL(/\/v2\/login$/);
  await open(page, "/v2/welcome");
  await expect(page).toHaveURL(/\/v2\/login$/);

  await signInNewcomer(page);
  // Нет ни вкладок, ни разделов, ни «Назад»; «Выйти» одна, в шапке; в доке только «Продолжить».
  await expect(page.getByRole("navigation", { name: shell.navLabel })).toHaveCount(0);
  await expect(page.getByRole("link", { name: new RegExp(`^${ru.app.kit.back}`) })).toHaveCount(0);
  await expect(page.getByRole("button", { name: shell.logout, exact: true })).toHaveCount(1);
  await expect(page.locator("[data-action-dock]").getByRole("button")).toHaveCount(1);
  await expect(page.getByRole("link", { name: ru.common.brand })).toHaveAttribute("href", "/v2");

  await page.getByRole("button", { name: shell.logout, exact: true }).click();
  await expect(page).toHaveURL(/\/v2\/login$/);
});

test("телефон: на первом экране согласия видны заголовок, начало текста, отметка и кнопка; док не перекрывает отметку", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "первый экран — только телефон");
  await signInNewcomer(page);
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("нет размера окна");
  const checkbox = page.getByText(consent.agree, { exact: true });
  const dock = page.locator("[data-action-dock]");
  await expect(heading(page, consent.title)).toBeInViewport();
  await expect(page.getByRole("region", { name: consent.textLabel })).toBeInViewport();
  await expect(checkbox).toBeInViewport({ ratio: 1 });
  await expect(primary(page, consent.submit)).toBeInViewport({ ratio: 1 });
  const [box, dockBox] = [await checkbox.boundingBox(), await dock.boundingBox()];
  expect(box && dockBox && box.y + box.height <= dockBox.y).toBe(true);
  // Панели вкладок нет, док у самого нижнего края.
  await expect(page.locator("[data-tab-bar]")).toHaveCount(0);
  expect(dockBox && viewport.height - (dockBox.y + dockBox.height)).toBeLessThanOrEqual(24);
});
