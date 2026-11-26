import { expect, test, type Page } from "@playwright/test";
import { testBin } from "@/seed/kz-id";
import { ru } from "@/i18n/ru";
import { IIN_MASK } from "@/kit/mask-logic";
import { freshIin, freshPhone, loginV2, open, passOnboarding } from "./support";

/**
 * Регистрация мастера в новом интерфейсе (`/v2/register/executor`): гость видит, что нужно, и входит с возвратом; новый
 * человек, выбравший «Я мастер», после первых шагов попадает в анкету по шагам; ТОО вводит БИН и ИИН директора — они не
 * попадают ни в адрес, ни в хранилище вкладки и на экране показаны последними 4 цифрами; перезагрузка не теряет остальное;
 * отправка ведёт на экран «на проверке». Номера и ИИН каждый раз новые (identity стенда помнит их между прогонами).
 * Путь «Я мастер» не показывает главную покупателя: до отправки анкеты `/v2` ведёт на анкету — и у нового номера, и у
 * засеянного покупателя без профиля мастера (Айгерим, +7 700 000 01 01: её данные сценарий не меняет — выходит из анкеты
 * кнопкой «Сначала заказать мебель»). Подписи — только из ru.
 */

const t = ru.app.masterRegister;
const shell = ru.app.shell;
const howTo = ru.app.masterRequests.howTo;
const PATH = "/v2/register/executor";
const SEED_BUYER = "+7 700 000 01 01";

/** Новый номер стенда вида «+7 700 000 9X XX» (засеянные люди — 00…04 XX). */
function standPhone(): string {
  const d = () => Math.floor(Math.random() * 10);
  return `+7 700 000 9${d()} ${d()}${d()}`;
}

const heading = (page: Page, name: string) => page.getByRole("heading", { level: 1, name });
const primary = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
/** «Назад» с названием родителя (имя для диктора — «Назад: …»). */
const back = (page: Page, parent: string) => page.getByRole("link", { name: `${ru.app.kit.back}: ${parent}`, exact: true });

/** Ровно один `<h1>` и не больше одного главного действия на экране. */
async function expectScreenRules(page: Page) {
  await expect(page.locator("h1")).toHaveCount(1);
  expect(await page.locator("[data-primary-action]").count()).toBeLessThanOrEqual(1);
}

/** Новый БИН с верной контрольной цифрой (не для всех основ она есть — повтор). */
function freshBin(): string {
  for (;;) {
    const yymm = `${String(10 + Math.floor(Math.random() * 15)).padStart(2, "0")}${String(1 + Math.floor(Math.random() * 12)).padStart(2, "0")}`;
    try {
      return testBin(yymm, 1 + Math.floor(Math.random() * 99_999));
    } catch {
      // Для этой основы нет допустимой контрольной цифры.
    }
  }
}

/**
 * Первый шаг анкеты у того, кто идёт к профилю мастера: оболочка с меню, но без «Заказать мебель»; «Назад» нет — выход
 * «Сначала заказать мебель».
 */
async function expectMasterFirstStep(page: Page) {
  await expect(page).toHaveURL(PATH);
  await expect(heading(page, t.steps.form)).toBeVisible();
  await expectScreenRules(page);
  await expect(page.getByRole("navigation", { name: shell.navLabel })).toBeVisible();
  await expect(page.getByRole("link", { name: shell.order, exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: new RegExp(`^${ru.app.kit.back}`) })).toHaveCount(0);
  await expect(page.getByRole("button", { name: t.orderFirst, exact: true })).toBeVisible();
}

/** Содержимое хранилища вкладки (sessionStorage) одной строкой. */
const tabStorage = (page: Page) => page.evaluate(() => JSON.stringify({ ...window.sessionStorage }));

test.beforeEach(async ({ context }) => {
  await context.clearCookies();
});

test("гость: что нужно и вход мастером с возвратом сюда", async ({ page }) => {
  await open(page, PATH);
  await expect(heading(page, t.guest.title)).toBeVisible();
  await expectScreenRules(page);
  for (const step of t.guest.steps) await expect(page.getByText(step)).toBeVisible();
  const action = page.getByRole("link", { name: t.guest.action });
  await expect(action).toHaveAttribute("href", `/v2/login?role=executor&next=${encodeURIComponent(PATH)}`);
});

test("новый мастер (ТОО): анкета по шагам, номера только 4 цифрами, перезагрузка, отправка → на проверке", async ({ page }) => {
  test.setTimeout(180_000);
  await loginV2(page, freshPhone().typed, { role: "executor" });
  await passOnboarding(page, { fullName: "Сапаров Ерлан" });
  await page.waitForURL((url) => url.pathname === PATH);

  // Шаг 1: без выбора — ошибка у группы; «Назад» нет (идёт к профилю мастера) — выход «Сначала заказать мебель».
  await expectMasterFirstStep(page);
  await expect(page.getByText(t.form.keepsBuyer)).toBeVisible();
  await primary(page, t.next).click();
  await expect(page.getByText(t.errors.legalForm)).toBeVisible();
  await page.getByText(t.form.legalForms.TOO, { exact: true }).click();
  await primary(page, t.next).click();

  // Шаг 2: ТОО — наименование, БИН, директор и его ИИН; ошибки у полей.
  await expect(heading(page, t.steps.name)).toBeVisible();
  await expect(page).toHaveURL(`${PATH}?step=name`);
  await primary(page, t.next).click();
  await expect(page.getByText(t.errors.binRequired)).toBeVisible();
  // Фокус — на первое поле с ошибкой (наименование заполнено ФИО не было: у ТОО оно пустое).
  await expect(page.getByLabel(t.name.legalName.TOO)).toBeFocused();
  const bin = freshBin();
  const directorIin = freshIin();
  await page.getByLabel(t.name.legalName.TOO).fill("ТОО «Ағаш»");
  await page.getByLabel(t.name.bin).fill(bin);
  await page.getByLabel(t.name.director.name).fill("Тулегенов Бауыржан");
  await page.getByLabel(t.name.director.iin).fill(directorIin);

  // Перезагрузка: наименование и директор на месте, номеров нет ни в адресе, ни в хранилище вкладки.
  await page.waitForTimeout(300);
  expect(await tabStorage(page)).not.toContain(bin);
  expect(await tabStorage(page)).not.toContain(directorIin);
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(heading(page, t.steps.name)).toBeVisible();
  await expect(page.getByLabel(t.name.legalName.TOO)).toHaveValue("ТОО «Ағаш»");
  await expect(page.getByLabel(t.name.director.name)).toHaveValue("Тулегенов Бауыржан");
  await expect(page.getByLabel(t.name.bin)).toHaveValue("");
  await expect(page.getByText(t.name.numbersNotSaved)).toBeVisible();
  await page.getByLabel(t.name.bin).fill(bin);
  await page.getByLabel(t.name.director.iin).fill(directorIin);
  await primary(page, t.next).click();

  // Шаг 3: где работаете; «Назад» — на шаг 2 с введённым.
  await expect(heading(page, t.steps.place)).toBeVisible();
  await back(page, t.steps.name).click();
  await expect(heading(page, t.steps.name)).toBeVisible();
  // Поле показывает номер группами («200240 215 722», IinField); в форму уходят цифры без пробелов.
  await expect(page.getByLabel(t.name.bin)).toHaveValue(IIN_MASK.format(bin));
  await primary(page, t.next).click();
  await expect(heading(page, t.steps.place)).toBeVisible();
  await expect(page.getByLabel(t.place.city, { exact: true })).toHaveValue(t.place.defaultCity);
  await page.getByLabel(t.place.experience).fill("7");
  await primary(page, t.next).click();

  // Шаг 4: сводка — БИН и ИИН директора последними 4 цифрами, полного номера на странице нет.
  await expect(heading(page, t.steps.check)).toBeVisible();
  await expectScreenRules(page);
  await expect(page.getByText(t.check.masked(bin.slice(-4)))).toBeVisible();
  await expect(page.getByText(t.check.masked(directorIin.slice(-4)))).toBeVisible();
  const html = await page.content();
  expect(html).not.toContain(bin);
  expect(html).not.toContain(directorIin);
  expect(page.url()).not.toContain(bin);

  await primary(page, t.submit).dblclick();
  await expect(heading(page, t.status.title)).toBeVisible();
  await expect(page).toHaveURL(PATH);
  await expect(page.getByText(t.status.pending.now)).toBeVisible();
  await expect(page.getByText(t.check.masked(bin.slice(-4)))).toBeVisible();
  // Документы ещё не поданы — «Загрузить документы» единственное главное действие.
  const documents = page.locator("[data-primary-action]");
  await expect(documents).toHaveText(t.status.pending.documents);
  await expect(documents).toHaveAttribute("href", "/v2/executor/profile/kyc");
  await expectScreenRules(page);
  expect(await page.content()).not.toContain(bin);
  expect(await tabStorage(page)).not.toContain("ТОО «Ағаш»");

  // Анкета на проверке: адрес шага открывает статус, а не анкету.
  await open(page, `${PATH}?step=form`);
  await expect(heading(page, t.status.title)).toBeVisible();
});

test("новый номер, «Я мастер»: главной покупателя нет до отправки анкеты, после — статус с «Как взять заказ»", async ({ page }) => {
  test.setTimeout(180_000);
  await loginV2(page, standPhone(), { role: "executor" });
  await passOnboarding(page, { fullName: "Нурланов Арман" });
  await expectMasterFirstStep(page);

  // Главная до отправки анкеты ведёт обратно на анкету.
  await open(page, "/v2");
  await expectMasterFirstStep(page);

  // Самозанятый: наименование — ФИО из знакомства, номера вводить не нужно.
  await page.getByText(t.form.legalForms.SELF_EMPLOYED, { exact: true }).click();
  await primary(page, t.next).click();
  await expect(heading(page, t.steps.name)).toBeVisible();
  await expect(page.getByLabel(t.name.legalName.SELF_EMPLOYED)).toHaveValue("Нурланов Арман");
  await primary(page, t.next).click();
  await expect(heading(page, t.steps.place)).toBeVisible();
  await page.getByLabel(t.place.experience).fill("3");
  await primary(page, t.next).click();
  await expect(heading(page, t.steps.check)).toBeVisible();
  await primary(page, t.submit).click();

  // Статус проверки: «Как взять заказ» — четыре шага и строка о том, что заявки откроются после проверки.
  await expect(heading(page, t.status.title)).toBeVisible();
  await expect(page).toHaveURL(PATH);
  await expect(page.getByRole("heading", { level: 2, name: howTo.title })).toBeVisible();
  await expect(page.getByText(howTo.beforeApproval)).toBeVisible();
  await expect(page.locator("ol").filter({ hasText: howTo.steps[0] }).locator("li")).toHaveCount(howTo.steps.length);
  await expectScreenRules(page);
  await expect(page.getByRole("link", { name: shell.order, exact: true })).toHaveCount(0);

  // И после отправки главная — не покупателя.
  await open(page, "/v2");
  await expect(heading(page, t.status.title)).toBeVisible();
});

test("засеянный покупатель без профиля мастера, «Я мастер»: сразу анкета; «Сначала заказать мебель» — на главную покупателя", async ({
  page,
}) => {
  await loginV2(page, SEED_BUYER, { role: "executor" });
  await expectMasterFirstStep(page);
  await open(page, "/v2");
  await expectMasterFirstStep(page);

  // Передумал: выбор забыт — главная покупателя с его разделами («Заявки» в меню), и она остаётся после перезагрузки.
  // «Заказать мебель» здесь не проверяем: на телефоне у Айгерим главное действие — подписать оферту.
  await page.getByRole("button", { name: t.orderFirst, exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/v2");
  const requestsTab = page.getByRole("navigation", { name: shell.navLabel }).locator('a[href="/v2/requests"]');
  await expect(requestsTab).toBeVisible();
  await open(page, "/v2");
  await expect(page).toHaveURL(/\/v2$/);
  await expect(requestsTab).toBeVisible();
});
