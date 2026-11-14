import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { ru } from "@/i18n/ru";
import { DEFAULT_FURNITURE_TYPES, SEGMENT_NAMES } from "@/verticals/furniture";
import { freshPhone, loginV2, open, passOnboarding } from "./support";

/**
 * Заявка покупателя в новом интерфейсе: «Мои заявки» и мастер из пяти шагов. Новый покупатель (номер и ИИН каждый раз
 * новые) создаёт заявку от главной: ошибки у полей, двойной «Дальше», фото, «Назад» без потери ввода, возврат к черновику
 * из «Моих заявок», двойная отправка — одна заявка. Прямая заявка — из профиля мастера (`?executor=<номер>`). Данные
 * базы e2e не пересеваются; подписи — только из ru; на каждом экране один `<h1>` и не больше одного главного действия.
 */

const list = ru.app.requests.list;
const w = ru.app.requests.wizard;
const v = ru.requests.validation;
const step = ru.app.kit.wizard.step;
const KITCHEN = DEFAULT_FURNITURE_TYPES[0].name;
const PHOTO = path.join(__dirname, "..", "public", "landing", "kitchen.jpg");

const heading = (page: Page, name: string) => page.getByRole("heading", { level: 1, name });
const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

async function expectScreenRules(page: Page) {
  await expect(page.locator("h1")).toHaveCount(1);
  expect(await page.locator("[data-primary-action]").count()).toBeLessThanOrEqual(1);
}

/** Новый покупатель после входа и первых шагов — у себя на главной. */
async function newBuyer(page: Page) {
  await loginV2(page, freshPhone().typed);
  await passOnboarding(page);
}

test.beforeEach(async ({ context }) => {
  await context.clearCookies();
});

test("новый покупатель: заявка от главной до «Моих заявок» — ошибки у полей, фото, черновик, одна отправка", async ({ page }) => {
  await newBuyer(page);

  // Пустой список учит, зачем раздел, и предлагает одно действие.
  await open(page, "/v2/requests");
  await expect(heading(page, list.title)).toBeVisible();
  await expect(page.getByText(list.emptyTitle)).toBeVisible();
  await expectScreenRules(page);

  // С главной — в мастер.
  await open(page, "/v2");
  await page.locator('main a[href="/v2/requests/new"]').first().click();
  await expect(heading(page, w.start.title)).toBeVisible();
  await expect(page.getByText(step(1, 5))).toBeVisible();
  await expectScreenRules(page);

  // Шаг 1: без выбора — ошибка у поля, запрос не уходит; двойной «Дальше» — один черновик.
  await button(page, w.next).click();
  await expect(page.getByText(v.typeRequired)).toBeVisible();
  await page.getByText(KITCHEN, { exact: true }).click();
  await button(page, w.next).dblclick();
  await page.waitForURL(/step=segment/);
  const draftId = new URL(page.url()).searchParams.get("draft");
  expect(draftId).toBeTruthy();

  // Шаг 2: уровень.
  await expect(page.getByText(step(2, 5))).toBeVisible();
  await expect(heading(page, w.segment.title)).toBeVisible();
  await button(page, w.next).click();
  await expect(page.getByText(v.segmentRequired)).toBeVisible();
  await page.getByText(SEGMENT_NAMES.COMFORT, { exact: true }).click();
  await button(page, w.next).click();
  await page.waitForURL(/step=room/);

  // Шаг 3: фото и описание.
  await expect(heading(page, w.room.title)).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(PHOTO);
  await expect(page.getByText(ru.app.kit.uploader.done)).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByText(ru.app.kit.uploader.counter(1, 10))).toBeVisible();
  await page.getByLabel(w.room.description).fill("Кухня до потолка, нужна посудомойка");

  // «‹ Уровень» с шага фото сохраняет шаг: вернувшись, фото и описание на месте.
  await page.getByRole("link", { name: `${ru.app.kit.back}: ${w.steps[1]}` }).click();
  await page.waitForURL(/step=segment/);
  await button(page, w.next).click();
  await page.waitForURL(/step=room/);
  await expect(page.getByText(ru.app.kit.uploader.done)).toHaveCount(1);
  await expect(page.getByLabel(w.room.description)).toHaveValue("Кухня до потолка, нужна посудомойка");
  await button(page, w.next).click();
  await page.waitForURL(/step=place/);

  // Шаг 4: введённый, но не отправленный адрес переживает «Назад».
  await expect(heading(page, w.place.title)).toBeVisible();
  await page.getByLabel(w.place.address).fill("ул. Кенесары, 40");
  await page.getByRole("link", { name: `${ru.app.kit.back}: ${w.steps[2]}` }).click();
  await page.waitForURL(/step=room/);
  await expect(page.getByText(ru.app.kit.uploader.done)).toHaveCount(1);
  await button(page, w.next).click();
  await page.waitForURL(/step=place/);
  await expect(page.getByLabel(w.place.address)).toHaveValue("ул. Кенесары, 40");

  // Ошибки у полей (словами v2), точка по адресу (мок-геокодер знает центр города).
  await page.getByLabel(w.place.address).fill("");
  await page.getByLabel(w.place.city).fill("");
  await button(page, w.next).click();
  await expect(page.getByText(v.cityRequired)).toBeVisible();
  await expect(page.getByText(w.errors.addressRequired)).toBeVisible();
  await page.getByLabel(w.place.city).fill("Астана");
  await page.getByLabel(w.place.address).fill("ул. Достык, 5");
  await button(page, w.place.findPoint).click();
  await expect(page.getByText(w.place.pointCity)).toBeVisible();
  await button(page, w.next).click();
  await page.waitForURL(/step=send/);

  // Шаг 5: сводка.
  await expect(heading(page, w.send.title)).toBeVisible();
  await expect(page.getByText(step(5, 5))).toBeVisible();
  const summary = page.locator("main");
  await expect(summary.getByRole("heading", { level: 2, name: w.send.summaryTitle })).toBeVisible();
  await expect(summary).toContainText(KITCHEN);
  await expect(summary).toContainText(SEGMENT_NAMES.COMFORT);
  await expect(summary).toContainText(w.send.photosCount(1));
  await expect(summary).toContainText("Астана, ул. Достык, 5");
  await expectScreenRules(page);

  // «Мои заявки»: черновик ведёт обратно в мастер на свой шаг.
  await open(page, "/v2/requests");
  const draftRow = page.locator(`a[href="/v2/requests/new?draft=${draftId}"]`);
  await expect(draftRow).toContainText(ru.app.requests.state.draft);
  await expect(draftRow).toContainText(list.draftProgress(4, 5));
  await draftRow.click();
  await expect(heading(page, w.send.title)).toBeVisible();

  // Двойная отправка — одна заявка; дальше — её карточка с отметкой «отправлена».
  await button(page, w.submit).dblclick();
  await page.waitForURL(new RegExp(`/v2/requests/${draftId}\\?sent=1`));

  await open(page, "/v2/requests");
  const sent = page.locator(`a[href="/v2/requests/${draftId}"]`);
  await expect(sent).toHaveCount(1);
  await expect(sent).toContainText(ru.app.requests.state.waiting);
  await expect(page.locator('a[href^="/v2/requests/new?draft="]')).toHaveCount(0);
});

test("прямая заявка из профиля мастера: «Заявка для: Исполнитель №N» на каждом шаге, отправка одному мастеру", async ({ page }) => {
  await newBuyer(page);

  await open(page, "/v2/catalog");
  await page.locator('main a[href^="/v2/executors/"]').first().click();
  await page.waitForURL(/\/v2\/executors\/\d+/);
  const publicNumber = Number(new URL(page.url()).pathname.split("/").pop());
  await page.getByRole("link", { name: ru.app.guest.executor.action }).click();
  await page.waitForURL(new RegExp(`/v2/requests/new\\?executor=${publicNumber}`));

  const forWhom = w.directFor(ru.common.executorLabel(publicNumber));
  await expect(page.getByText(forWhom)).toBeVisible();
  // «Назад» с первого шага — в профиль этого мастера.
  await expect(page.getByRole("link", { name: `${ru.app.kit.back}: ${ru.common.executorLabel(publicNumber)}` })).toHaveAttribute(
    "href",
    `/v2/executors/${publicNumber}`,
  );
  await page.getByText(KITCHEN, { exact: true }).click();
  await button(page, w.next).click();
  await page.waitForURL(/step=segment/);
  await expect(page.getByText(forWhom)).toBeVisible();
  await expect(page.getByText(w.segment.leadDirect(ru.common.executorLabel(publicNumber)))).toBeVisible();
  // Уровень уже выбран — уровень мастера.
  await button(page, w.next).click();
  await page.waitForURL(/step=room/);
  await button(page, w.next).click();
  await page.waitForURL(/step=place/);
  await page.getByLabel(w.place.city).fill("Алматы");
  await page.getByLabel(w.place.address).fill("пр. Абая, 10");
  await button(page, w.next).click();
  await page.waitForURL(/step=send/);
  await expect(page.getByText(w.send.footnoteDirect(ru.common.executorLabel(publicNumber)))).toBeVisible();
  await button(page, w.submitDirect).click();
  await page.waitForURL(/\/v2\/requests\/[^/?]+\?sent=1/);
});

test("несуществующий номер мастера и чужой черновик — «Страница не найдена»", async ({ page }) => {
  await newBuyer(page);
  await open(page, "/v2/requests/new?executor=999999999");
  await expect(heading(page, ru.app.shell.notFoundTitle)).toBeVisible();
  await open(page, "/v2/requests/new?draft=no-such-draft");
  await expect(heading(page, ru.app.shell.notFoundTitle)).toBeVisible();
});
