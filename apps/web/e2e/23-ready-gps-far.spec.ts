import { expect, test } from "@playwright/test";
import { pdfText } from "./pdf-text";
import { expectDealStatus, expectOnePrimary, loginAs, nextStep, openDeal, P, phone, POINT, reseed, signFromNextStep, stepAction, submitReady } from "./support";

/**
 * Критерий ТЗ 6: GPS вне радиуса предупреждает, но не блокирует сдачу. Сделка №6 сида — IN_PROGRESS,
 * Айгерим ↔ Ерлан (Исп. №3), адрес «ул. Демонстрационная, 12» с точкой на карте. Телефон мастера — около 5 км
 * от адреса (geolocation контекста Playwright). Работа сдана, у обеих сторон — предупреждение, акт можно подписать.
 */

test.describe.configure({ mode: "serial" }); // второй шаг смотрит сдачу из первого
test.beforeAll(() => {
  test.setTimeout(120_000);
  reseed();
});

test("сдача вдали от адреса: предупреждение, работа сдана, покупатель может подписать акт", async ({ browser }, info) => {
  test.setTimeout(240_000);
  const ctx = await phone(browser, info, POINT.far);
  const master = await ctx.newPage();
  await loginAs(master, P.erlan);
  await openDeal(master, 6);
  await expectDealStatus(master, "Идут работы");
  // Шаг-форма (сдача с фото): заливная — только «Сдать работу», отправка в чате вторичная.
  await expectOnePrimary(master);
  await submitReady(master);

  const ready = master.getByRole("region", { name: "Сдача работы" });
  await expect(ready.getByRole("alert").or(ready.getByRole("status")).first()).toContainText(/Сдано в \d[\d\s]* м от адреса заказа — дальше 500 м\./);
  await expectDealStatus(master, "Работа сдана, ждёт приёмки");
  await expect(stepAction(master).getByRole("link", { name: "Подписать акт ЭЦП" })).toBeVisible();
  await ctx.close();
});

test("покупатель видит предупреждение о расстоянии и подписывает акт", async ({ page }) => {
  await loginAs(page, P.aigerim);
  const dealPath = await openDeal(page, 6);
  await expectDealStatus(page, "Работа сдана, ждёт приёмки");
  await expect(page.getByRole("region", { name: "Сдача работы" })).toContainText(/Сдано в \d[\d\s]* м от адреса заказа — дальше 500 м\./);
  await expect(stepAction(page).getByRole("link", { name: "Подписать акт" })).toBeVisible();
  const act = page.getByRole("region", { name: /^Акт приёмки № / });
  const href = await act.getByRole("link", { name: /^Открыть PDF/ }).getAttribute("href");
  const res = await page.request.get(href ?? "");
  expect(res.status()).toBe(200);
  expect(await pdfText(await res.body())).toMatch(/вне\s+радиуса\s+500\s+м\s+—\s+предупреждение/);

  // Предупреждение не блокирует приёмку: акт подписывается, дальше — подпись мастера
  await signFromNextStep(page, "Подписать акт");
  await page.goto(dealPath);
  await expect(nextStep(page)).toContainText("Акт подписан вами. Ждём подпись мастера");
});
