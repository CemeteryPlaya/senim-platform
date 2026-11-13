import { expect, test, type Page } from "@playwright/test";
import { ru } from "@/i18n/ru";
import { freshEmail, freshIin, freshPhone, loginV2, open, readShownCode } from "./support";

/**
 * Почта — последний шаг после входа в новом интерфейсе: адрес → код из письма (код с экрана: у identity стенда заглушка
 * отправки писем). Полный путь нового покупателя до главной и нового мастера до регистрации мастера; существующий человек
 * без почты останавливается на шаге и после подтверждения попадает туда, куда шёл; двойной клик «Получить код» — один
 * запрос; подтверждается ровно адрес, показанный на экране. Номера, ИИН и адреса каждый раз новые: identity стенда помнит
 * их между прогонами. Подписи — только из ru.
 */

const consent = ru.app.onboarding.consent;
const welcome = ru.app.onboarding.welcome;
const t = ru.app.onboarding.email;
const errors = ru.app.login.email.errors;
const shell = ru.app.shell;

const heading = (page: Page, name: string) => page.getByRole("heading", { level: 1, name });
const primary = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const emailCode = (page: Page) => readShownCode(page, t.code.shownCode);

/** Согласие и знакомство: человек приходит на шаг почты. */
async function toEmailStep(page: Page) {
  await page.getByText(consent.agree, { exact: true }).click();
  await primary(page, consent.submit).click();
  await expect(heading(page, welcome.title)).toBeVisible();
  await page.getByLabel(welcome.fullName).fill("Сапаров Ерлан");
  await page.getByLabel(welcome.iin).fill(freshIin());
  await primary(page, welcome.submit).click();
  await expect(heading(page, t.address.title)).toBeVisible();
  await page.waitForLoadState("networkidle");
}

/** Адрес → код с экрана → «Подтвердить». */
async function confirmEmail(page: Page, email = freshEmail()) {
  await page.getByLabel(t.address.label).fill(email);
  await primary(page, t.address.submit).click();
  await page.getByLabel(t.code.label).fill(await emailCode(page));
  await primary(page, t.code.submit).click();
}

/** Ровно один `<h1>` и не больше одного главного действия на экране. */
async function expectScreenRules(page: Page) {
  await expect(page.locator("h1")).toHaveCount(1);
  expect(await page.locator("[data-primary-action]").count()).toBeLessThanOrEqual(1);
}

test.beforeEach(async ({ context }) => {
  await context.clearCookies();
});

test("новый покупатель: почта с ошибками у полей, неверный код, подтверждение — главная; шаг больше не открывается", async ({
  page,
}) => {
  await loginV2(page, freshPhone().typed);
  await toEmailStep(page);

  // Шаг 3 из 3, сосредоточенная оболочка, в доке одна кнопка.
  await expect(page).toHaveURL(/\/v2\/email$/);
  await expect(page.getByText(ru.app.kit.wizard.step(3, 3))).toBeVisible();
  await expectScreenRules(page);
  await expect(page.getByRole("navigation", { name: shell.navLabel })).toHaveCount(0);
  await expect(page.locator("[data-action-dock]").getByRole("button")).toHaveCount(1);

  // «Зачем почта» — по нажатию.
  await page.getByRole("button", { name: t.explain.label }).click();
  await expect(page.getByText(t.explain.body)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText(t.explain.body)).toHaveCount(0);

  // Пусто и неверный формат — ошибки у поля.
  const field = page.getByLabel(t.address.label);
  await primary(page, t.address.submit).click();
  await expect(page.getByText(t.errors.required)).toBeVisible();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await field.fill("erlan@");
  await primary(page, t.address.submit).click();
  await expect(page.getByText(errors.invalid)).toBeVisible();

  // Верный адрес — шаг кода; адреса почты нет в адресе страницы; фокус на поле кода.
  const email = freshEmail();
  await field.fill(email);
  await primary(page, t.address.submit).click();
  await expect(heading(page, t.code.title)).toBeVisible();
  await expect(page).toHaveURL(/\/v2\/email\?step=code$/);
  expect(page.url()).not.toContain("example.com");
  await expect(page.getByText(t.code.sentTo(email))).toBeVisible();
  await expect(page.getByLabel(t.code.label)).toBeFocused();
  // Повтор до конца отсчёта — строка текста, а не кнопка.
  await expect(page.getByText(new RegExp(`^${t.code.resend} через [01]:[0-5][0-9]$`))).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(`^${t.code.resend}`) })).toHaveCount(0);
  await expect(page.locator("[data-action-dock]").getByRole("button")).toHaveCount(1);
  await expectScreenRules(page);
  const code = await emailCode(page);

  // Неверный код — у поля, с числом оставшихся попыток.
  await page.getByLabel(t.code.label).fill(code === "000000" ? "111111" : "000000");
  await primary(page, t.code.submit).click();
  await expect(page.getByText(errors.wrongCode(4))).toBeVisible();
  await expect(page.getByLabel(t.code.label)).toHaveAttribute("aria-invalid", "true");

  // «Изменить адрес» — адрес в поле; «Назад» браузера — снова шаг кода с тем же кодом.
  await page.getByRole("link", { name: t.code.changeEmail }).click();
  await expect(page.getByLabel(t.address.label)).toHaveValue(email);
  await page.goBack();
  await expect(heading(page, t.code.title)).toBeVisible();

  // Верный код — главная; выбор роли забыт; шаг почты пройден и больше не открывается.
  await page.getByLabel(t.code.label).fill(code);
  await primary(page, t.code.submit).click();
  await expect(page).toHaveURL(/\/v2$/);
  await expectScreenRules(page);
  expect((await page.context().cookies()).map((c) => c.name)).not.toContain("senim_login_role");
  await open(page, "/v2/email");
  await expect(page).toHaveURL(/\/v2$/);
});

test("новый мастер: после почты — регистрация мастера", async ({ page }) => {
  await loginV2(page, freshPhone().typed, { role: "executor" });
  await toEmailStep(page);
  await confirmEmail(page);
  await expect(page).toHaveURL(/\/v2\/register\/executor$/);
});

test("двойной клик «Получить код» — один запрос и один код; перезагрузка шага кода — шаг адреса, повтор в ту же минуту — снова шаг кода с прежним кодом", async ({
  page,
}) => {
  await loginV2(page, freshPhone().typed);
  await toEmailStep(page);

  let actions = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.headers()["next-action"]) actions += 1;
  });
  const email = freshEmail();
  await page.getByLabel(t.address.label).fill(email);
  await primary(page, t.address.submit).dblclick();
  await expect(heading(page, t.code.title)).toBeVisible();
  await expect(page.getByText(new RegExp(t.code.shownCode("\\d{6}")))).toHaveCount(1);
  await page.waitForLoadState("networkidle");
  expect(actions).toBe(1);
  const code = await emailCode(page);

  // Адрес почты живёт только в памяти страницы: после перезагрузки — шаг адреса с пустым полем.
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(heading(page, t.address.title)).toBeVisible();
  await expect(page).toHaveURL(/\/v2\/email$/);
  await expect(page.getByLabel(t.address.label)).toHaveValue("");

  // Новый запрос раньше минуты — не тупик: снова шаг кода с пояснением; второго кода нет, прежний подтверждает почту.
  await page.getByLabel(t.address.label).fill(email);
  await primary(page, t.address.submit).click();
  await expect(heading(page, t.code.title)).toBeVisible();
  await expect(page.getByText(t.code.alreadySent)).toBeVisible();
  await expect(page.getByText(t.code.sentTo(email))).toBeVisible();
  await expect(page.getByText(new RegExp(t.code.shownCode("\\d{6}")))).toHaveCount(0);
  await page.getByLabel(t.code.label).fill(code);
  await primary(page, t.code.submit).click();
  await expect(page).toHaveURL(/\/v2$/);
});

test("код на A → перезагрузка → B в ту же минуту: ошибка у поля, шага кода «для B» нет, A не подтверждена", async ({ page }) => {
  await loginV2(page, freshPhone().typed);
  await toEmailStep(page);
  const first = freshEmail();
  await page.getByLabel(t.address.label).fill(first);
  await primary(page, t.address.submit).click();
  await expect(heading(page, t.code.title)).toBeVisible();

  await page.reload();
  await page.waitForLoadState("networkidle");
  const second = freshEmail();
  await page.getByLabel(t.address.label).fill(second);
  await primary(page, t.address.submit).click();
  await expect(page.getByText(t.errors.otherAddress)).toBeVisible();
  await expect(page.getByLabel(t.address.label)).toHaveAttribute("aria-invalid", "true");
  await expect(heading(page, t.address.title)).toBeVisible();
  await expect(page.getByText(t.code.sentTo(second))).toHaveCount(0);
  await expect(page.getByText(t.code.alreadySent)).toHaveCount(0);

  // Почта не подтверждена: шаг почты по-прежнему открывается.
  await open(page, "/v2/email");
  await expect(heading(page, t.address.title)).toBeVisible();
});

test("существующий человек без почты: после входа — шаг почты с сохранённым next, после подтверждения — туда, куда шёл", async ({
  page,
}, info) => {
  // Повторный вход тем же номером возможен через минуту (лимит кода identity) — сценарий идёт на одном устройстве.
  test.skip(info.project.name !== "desktop", "повторный вход ждёт минуту — достаточно одного устройства");
  test.setTimeout(180_000);
  const phone = freshPhone().typed;
  const firstCodeAt = Date.now();
  await loginV2(page, phone);
  await toEmailStep(page);
  await primary(page, shell.logout).click();
  await expect(page).toHaveURL(/\/v2\/login$/);

  await page.waitForTimeout(Math.max(0, firstCodeAt + 62_000 - Date.now()));
  const next = "/v2/about";
  await loginV2(page, phone, { next });
  await expect(page).toHaveURL(new RegExp(`/v2/email\\?next=${encodeURIComponent(next)}$`));
  await expect(page.getByText(ru.app.kit.wizard.step(3, 3))).toBeVisible();

  await confirmEmail(page);
  await expect(page).toHaveURL(new RegExp(`${next}$`));
});
