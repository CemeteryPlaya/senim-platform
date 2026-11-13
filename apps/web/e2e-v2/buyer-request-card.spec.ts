import { expect, test, type Page } from "@playwright/test";
import { ru } from "@/i18n/ru";
import { loginV2, open } from "./support";

/**
 * Карточка заявки покупателя (`/v2/requests/[id]`) на засеянных людях: Айгерим (+7 700 000 01 01) — заявка с тремя
 * предложениями; Данияр (+7 700 000 01 02) — прямая заявка, чужая для Мадины (+7 700 000 01 03). Сценарий ничего не меняет в данных
 * (отмена — интеграционным тестом, пересев не включается). Порядок мастеров зависит от сида: у заявки с тремя предложениями
 * дешевле всех мастер №4, быстрее всех — №2.
 */

const t = ru.app.requestCard;
const list = ru.app.requests.list;

const AIGERIM = "+7 700 000 01 01";
const DANIYAR = "+7 700 000 01 02";
const MADINA = "+7 700 000 01 03";

async function openRequestWithOffers(page: Page, count: number): Promise<string> {
  await open(page, "/v2/requests");
  const link = page.locator("main a[href^='/v2/requests/']").filter({ hasText: list.offers(count) }).first();
  await link.click();
  await page.waitForURL(/\/v2\/requests\/[^/?]+$/);
  await page.waitForLoadState("networkidle");
  return new URL(page.url()).pathname;
}

const masters = (page: Page) => page.locator("main a[href*='/offers/']").evaluateAll((links) => links.map((a) => a.textContent?.match(/Исполнитель №(\d+)/)?.[1] ?? ""));

test.beforeEach(async ({ context }) => {
  await context.clearCookies();
});

test("заявка с тремя предложениями: «Исполнитель №N» без имён, сортировка в адресе меняет порядок", async ({ page }) => {
  await loginV2(page, AIGERIM);
  await openRequestWithOffers(page, 3);

  await expect(page.locator("h1")).toHaveCount(1);
  expect(await page.locator("[data-primary-action]").count()).toBeLessThanOrEqual(1);
  await expect(page.getByRole("heading", { level: 2, name: ru.app.buyer.home.now.offers.title(3) })).toBeVisible();
  await expect(page.getByRole("link", { name: /Исполнитель №\d+/ })).toHaveCount(3);
  // Имени и контактов мастера на экране нет, только номер.
  await expect(page.locator("main")).not.toContainText(/ТОО|\+7\s?\d{3}|@/);

  // По умолчанию — дешевле: №4, №3, №2.
  await expect(page.getByRole("button", { name: t.offers.sort.price })).toHaveAttribute("aria-pressed", "true");
  expect(await masters(page)).toEqual(["4", "3", "2"]);

  // «Быстрее»: адрес меняется, порядок меняется.
  await page.getByRole("button", { name: t.offers.sort.duration }).click();
  await page.waitForURL(/[?&]sort=duration/);
  await expect(page.getByRole("button", { name: t.offers.sort.duration })).toHaveAttribute("aria-pressed", "true");
  expect(await masters(page)).toEqual(["2", "3", "4"]);

  // Сортировка переживает перезагрузку: она в адресе.
  await page.reload();
  await expect(page.getByRole("button", { name: t.offers.sort.duration })).toHaveAttribute("aria-pressed", "true");
  expect(await masters(page)).toEqual(["2", "3", "4"]);

  // Предложение открывается ссылкой на свой экран v2.
  await page.getByRole("link", { name: /Исполнитель №2/ }).click();
  await page.waitForURL(/\/v2\/requests\/[^/]+\/offers\/[^/]+/);
});

test("прямая заявка без предложений: обучающий экран без кнопки; чужая и несуществующая заявка — 404", async ({ page, context }) => {
  // Номера входят не чаще раза в минуту, поэтому один вход Данияра на оба сценария, а чужой смотрит Мадина.
  await loginV2(page, DANIYAR);
  await open(page, "/v2/requests");
  const own = page.locator("main a[href^='/v2/requests/']").filter({ hasText: list.direct }).first();
  const foreign = await own.getAttribute("href");
  expect(foreign).toBeTruthy();
  await own.click();
  await page.waitForURL(/\/v2\/requests\/[^/?]+$/);
  await expect(page.getByRole("heading", { level: 2, name: t.now.waitingDirect.title })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: t.offers.emptyDirect.title })).toBeVisible();
  expect(await page.locator("[data-primary-action]").count()).toBe(0);
  await expect(page.locator("main")).toContainText(/Заявка для\s*Исполнитель №\d+/);
  await context.clearCookies();

  await loginV2(page, MADINA);
  for (const href of [foreign ?? "", "/v2/requests/net-takoj-zayavki"]) {
    const response = await page.goto(href);
    expect(response?.status(), href).toBe(404);
  }
});
