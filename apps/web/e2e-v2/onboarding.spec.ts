import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { ru } from "@/i18n/ru";
import { CONSENT_DOCUMENTS } from "@/i18n/ru/consent";
import { assertSafeDatabase } from "./safe-database";
import { freshIin, freshPhone, loginV2, open, passOnboarding, readShownCode } from "./support";

/**
 * Первые шаги после входа в новом интерфейсе: согласие на обработку данных → ФИО и ИИН → почта (сценарии почты —
 * email.spec.ts). Вход новым номером через код с экрана (номера и ИИН каждый раз новые: identity стенда помнит их между
 * прогонами). Вошедший с непройденными шагами не застревает на главной и гостевых страницах; прошедший видит обычную
 * оболочку. Подписи — только из ru; на каждом экране ровно один h1 и не больше одного главного действия.
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
  // Код уходит сам после последней цифры (CodeField autoSubmit) — кнопку не нажимаем.
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
  await expect(page.getByText(ru.app.onboarding.step(1, 3))).toBeVisible();
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

  // С отметкой — знакомство: «Шаг 2 из 3» (место в постоянной последовательности согласие → знакомство → почта).
  await page.getByText(consent.agree, { exact: true }).click();
  await primary(page, consent.submit).click();
  await expect(heading(page, welcome.title)).toBeVisible();
  await expect(page).toHaveURL(/\/v2\/welcome$/);
  await expect(page.getByText(ru.app.onboarding.step(2, 3))).toBeVisible();
  await expectScreenRules(page);

  // Пустые поля — обе ошибки сразу у полей.
  await primary(page, welcome.submit).click();
  await expect(page.getByText(welcome.errors.fullNameRequired, { exact: true })).toBeVisible();
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
  // Название на шагах — текст, а не ссылка: уходить со шагов некуда, кроме «Выйти».
  await expect(page.getByRole("link", { name: ru.common.brand })).toHaveCount(0);
  await expect(page.getByRole("banner").getByText(ru.common.brand, { exact: true })).toBeVisible();

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

test("телефон 390×844: отметка и «Продолжить» видны без прокрутки страницы; в конце текста подпись «Прокрутите…» гаснет", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "mobile", "первый экран — только телефон");
  await page.setViewportSize({ width: 390, height: 844 });
  await signInNewcomer(page);
  await expect(page.getByText(consent.agree, { exact: true })).toBeInViewport({ ratio: 1 });
  await expect(primary(page, consent.submit)).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  const fade = page.locator("[data-end]");
  await expect(fade).toHaveAttribute("data-end", "false");
  await expect(page.getByText(consent.scrollHint)).toHaveAttribute("aria-hidden", "false");
  await page.getByRole("region", { name: consent.textLabel }).evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  await expect(fade).toHaveAttribute("data-end", "true");
  await expect(page.getByText(consent.scrollHint)).toHaveAttribute("aria-hidden", "true");
});

test("ИИН уже указан в другом аккаунте — ошибка у поля ИИН, ФИО не теряется", async ({ page, context }) => {
  const iin = freshIin();
  await loginV2(page, freshPhone().typed);
  await passOnboarding(page, { iin });

  await context.clearCookies();
  await signInNewcomer(page);
  await page.getByText(consent.agree, { exact: true }).click();
  await primary(page, consent.submit).click();
  await expect(heading(page, welcome.title)).toBeVisible();
  await page.getByLabel(welcome.fullName).fill("Другой Человек");
  await page.getByLabel(welcome.iin).fill(iin);
  await primary(page, welcome.submit).click();
  // Текст v2 («в другом профиле») и ссылка на поддержку под полем; текст identity («аккаунте») на экран не попадает.
  await expect(page.getByText(welcome.errors.iinTaken)).toBeVisible();
  await expect(page.getByText(identityTexts.iinTaken)).toHaveCount(0);
  await expect(page.getByRole("link", { name: welcome.errors.supportLink })).toHaveAttribute("href", /^mailto:.+@.+/);
  await expect(page.getByLabel(welcome.iin)).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel(welcome.fullName)).toHaveValue("Другой Человек");
  await expect(page).toHaveURL(/\/v2\/welcome$/);
});

/**
 * Как на стенде после пересева базы web: identity помнит человека (согласие, ФИО и ИИН, подтверждённая почта), а в проекции
 * web нет ФИО, ИИН и почты. Стирается только строка этого нового человека в базе e2e (`senim_v2web_*`).
 */
async function forgetPersonInWeb(phoneDigits: string): Promise<void> {
  const url = process.env.E2E_DATABASE_URL ?? "";
  assertSafeDatabase(url);
  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    const res = await db.query(`update "User" set "fullName" = null, "iinLast4" = null, email = null, "emailVerifiedAt" = null where phone = $1`, [
      `+7${phoneDigits}`,
    ]);
    if (res.rowCount !== 1) throw new Error(`Нет пользователя +7${phoneDigits} в базе e2e`);
  } finally {
    await db.end();
  }
}

test("знакомство — последний шаг (почта уже подтверждена в identity): дом сразу в обычной оболочке, без перезагрузки", async ({
  page,
  context,
}, info) => {
  const phone = freshPhone();
  const iin = freshIin();
  await loginV2(page, phone.typed);
  await passOnboarding(page, { fullName: "Сапаров Ерлан", iin });
  await context.clearCookies();
  await forgetPersonInWeb(phone.digits);

  // Повторный вход (как у владельца — «Я мастер»): согласие и почта уже есть в identity, остаётся знакомство.
  await loginV2(page, phone.typed, { role: "executor" });
  await expect(heading(page, welcome.title)).toBeVisible();
  await page.getByLabel(welcome.fullName).fill("Сапаров Ерлан");
  await page.getByLabel(welcome.iin).fill(iin);
  await primary(page, welcome.submit).click();

  // Шаг почты пропускается (подтверждена) — дом идущего к профилю мастера, анкета (выбор «Я мастер» живёт до её
  // отправки). Оболочка уже обычная: раньше оставалась сосредоточенная шапка (название и «Выйти») без меню до перезагрузки.
  await page.waitForURL((url) => url.pathname === "/v2/register/executor");
  await expect(page.getByRole("navigation", { name: shell.navLabel })).toBeVisible();
  if (info.project.name === "mobile") {
    await expect(page.locator("[data-focus-bar]")).toHaveCount(0);
    await expect(page.locator("[data-tab-bar]")).toBeVisible();
  } else {
    await expect(page.getByRole("button", { name: shell.profileMenu })).toBeVisible();
    await expect(page.locator("[data-top-bar]").getByRole("button", { name: shell.logout, exact: true })).toHaveCount(0);
  }
});

test("вошедший с непройденными шагами не застревает: главная и каталог уводят на шаг с возвратом туда же", async ({ page }) => {
  await signInNewcomer(page);
  await page.getByText(consent.agree, { exact: true }).click();
  await primary(page, consent.submit).click();
  await expect(heading(page, welcome.title)).toBeVisible();

  /** Адрес сейчас: путь и параметр возврата. */
  const where = () => {
    const url = new URL(page.url());
    return { path: url.pathname, next: url.searchParams.get("next") };
  };

  await open(page, "/v2");
  await expect(heading(page, welcome.title)).toBeVisible();
  expect(where()).toEqual({ path: "/v2/welcome", next: "/v2" });

  const catalog = "/v2/catalog?type=kitchen";
  await open(page, catalog);
  await expect(heading(page, welcome.title)).toBeVisible();
  expect(where()).toEqual({ path: "/v2/welcome", next: catalog });

  // Пройдя шаги, человек возвращается в каталог с тем же фильтром.
  await passOnboarding(page);
  const back = new URL(page.url());
  expect(back.pathname + back.search).toBe(catalog);
});

test("прошедший онбординг: обычная оболочка — вкладки на телефоне, разделы и меню профиля на компьютере; выход через меню", async ({
  page,
}, info) => {
  await loginV2(page, freshPhone().typed);
  await passOnboarding(page);
  await expect(page).toHaveURL(/\/v2$/);
  await expect(page.getByRole("navigation", { name: shell.navLabel })).toBeVisible();
  if (info.project.name === "mobile") {
    await expect(page.locator("[data-tab-bar]")).toBeVisible();
    await expect(page.locator("[data-focus-bar]")).toHaveCount(0);
    return;
  }
  await expect(page.locator("[data-tab-bar]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: shell.logout, exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: shell.profileMenu }).click();
  await page.getByRole("menuitem", { name: shell.logout }).click();
  await expect(page).toHaveURL(/\/v2\/login$/);
  // Экран входа: «Войти» в шапке компьютера нет (человек уже на входе).
  await expect(heading(page, login.role.title)).toBeVisible();
  await expect(page.locator("[data-top-bar]").getByRole("link", { name: shell.nav.login, exact: true })).toHaveCount(0);
});

test("согласие на маленьком экране 320×568: отметка видна и не перекрыта кнопкой в доке", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await loginV2(page, freshPhone().typed);
  await expect(page).toHaveURL(/\/v2\/consent/);
  const agree = page.getByText(ru.app.onboarding.consent.agree, { exact: true });
  await agree.scrollIntoViewIfNeeded();
  await expect(agree).toBeVisible();
  // Центр подписи отметки — сама подпись или её флажок, а не панель с кнопкой поверх содержимого.
  const covered = await agree.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit !== null && !el.closest("label")?.contains(hit);
  });
  expect(covered).toBe(false);
});
