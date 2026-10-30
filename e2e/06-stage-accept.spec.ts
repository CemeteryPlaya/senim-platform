import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
import { choose, loginAs, nextStep, openDeal, P, reseed, signFromNextStep } from "./support";

/**
 * Сделка №11 (шкаф, «Аванс 50%», заказчик Айгерим, исполнитель Ерлан №3): этап 2 «Изготовление» сдан.
 * Заказчик принимает этап (двойное нажатие — одна приёмка) → акт → обе подписи → этап закрыт.
 * Исполнитель начинает и сдаёт этап 3 с фото → заказчик принимает → акт → «Я оплатил» →
 * исполнитель «Получил оплату» → сделка завершена → отзыв.
 */

test.beforeAll(() => {
  test.setTimeout(120_000);
  reseed();
});

function stage(page: Page, order: number) {
  return page
    .getByRole("region", { name: "Этапы работ" })
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: new RegExp(`^Этап ${order}\\.`) }) });
}
function actHeadings(page: Page) {
  return page.getByRole("region", { name: "Акты этапов" }).getByRole("heading", { name: /^Акт приёмки этапа № / });
}
function history(page: Page) {
  return page.locator("section").filter({ has: page.getByRole("heading", { name: "История сделки", exact: true }) }).getByRole("listitem");
}

/** Подписать акт из «Что дальше» и вернуться на свежий экран сделки. */
async function signAct(page: Page, dealPath: string, expected: "Подпись принята" | "Документ подписан обеими сторонами") {
  await expect(nextStep(page).getByText(/^Подпишите акт по этапу «/)).toBeVisible();
  const panel = await signFromNextStep(page);
  await expect(panel.getByText(expected)).toBeVisible();
  await page.goto(dealPath);
}

test("приёмка этапа, акт, оплата этапа с подтверждением и завершение сделки", async ({ page }) => {
  test.setTimeout(180_000);

  // ── Заказчик принимает этап 2 ──
  await loginAs(page, P.aigerim);
  const dealPath = await openDeal(page, 11);
  await expect(stage(page, 2).getByText("Сдан, ждёт приёмки")).toBeVisible();
  await expect(nextStep(page).getByText(/Если не ответить до .+, этап будет принят автоматически\./)).toBeVisible();
  const actsBefore = await actHeadings(page).count();
  const accepted = history(page).filter({ hasText: /^Этап принят/ });
  const acceptedBefore = await accepted.count();

  await nextStep(page).getByRole("button", { name: "Принять этап" }).dblclick();
  await expect(stage(page, 2).getByText("Принят", { exact: true })).toBeVisible();
  await page.goto(dealPath);
  // Двойное нажатие не дало второй приёмки и второго акта
  await expect(actHeadings(page)).toHaveCount(actsBefore + 1);
  await expect(accepted).toHaveCount(acceptedBefore + 1);
  await signAct(page, dealPath, "Подпись принята");

  // ── Исполнитель: подпись акта этапа 2, начало и сдача этапа 3 ──
  await loginAs(page, P.erlan);
  await page.goto(dealPath);
  await signAct(page, dealPath, "Документ подписан обеими сторонами");
  await expect(stage(page, 2).getByText("Закрыт", { exact: true })).toBeVisible();

  await nextStep(page).getByRole("button", { name: "Начать этап" }).click();
  await expect(stage(page, 3).getByText("В работе", { exact: true })).toBeVisible();
  await nextStep(page).getByLabel("Что сделано на этапе").fill("Шкаф установлен, фасады отрегулированы, мусор вывезен.");
  const photo = await sharp({ create: { width: 320, height: 240, channels: 3, background: "#b07a4a" } }).jpeg().toBuffer();
  const chooser = page.waitForEvent("filechooser");
  await nextStep(page).getByRole("button", { name: /^Загрузить фото/ }).click();
  await (await chooser).setFiles({ name: "montazh.jpg", mimeType: "image/jpeg", buffer: photo });
  await expect(nextStep(page).getByRole("img", { name: /Фото 1/ })).toBeVisible();
  await nextStep(page).getByRole("button", { name: "Сдать этап" }).click();
  await expect(stage(page, 3).getByText("Сдан, ждёт приёмки")).toBeVisible();

  // ── Заказчик: приёмка этапа 3, акт, отметка оплаты ──
  await loginAs(page, P.aigerim);
  await page.goto(dealPath);
  await expect(stage(page, 3).getByText("Шкаф установлен, фасады отрегулированы, мусор вывезен.")).toBeVisible();
  await nextStep(page).getByRole("button", { name: "Принять этап" }).click();
  await expect(stage(page, 3).getByText("Принят", { exact: true })).toBeVisible();
  await signAct(page, dealPath, "Подпись принята");
  await expect(nextStep(page).getByText(/^Оплатите этап «.+» исполнителю и отметьте оплату здесь\.$/)).toBeVisible();
  await nextStep(page).getByRole("button", { name: "Я оплатил" }).click();
  await expect(stage(page, 3).getByText("Заказчик отметил оплату")).toBeVisible();

  // ── Исполнитель: подпись акта и подтверждение оплаты ──
  await loginAs(page, P.erlan);
  await page.goto(dealPath);
  await signAct(page, dealPath, "Документ подписан обеими сторонами");
  await expect(nextStep(page).getByText(/^Заказчик отметил оплату этапа «/)).toBeVisible();
  await nextStep(page).getByRole("button", { name: "Получил оплату" }).click();
  await expect(stage(page, 3).getByText("Оплата получена")).toBeVisible();
  await expect(stage(page, 3).getByText("Закрыт", { exact: true })).toBeVisible();
  await expect(page.getByText("Завершена", { exact: true }).first()).toBeVisible();

  // ── Заказчик оставляет отзыв ──
  await loginAs(page, P.aigerim);
  await page.goto(dealPath);
  await expect(nextStep(page).getByText("Работа завершена. Оцените исполнителя — это поможет другим заказчикам.")).toBeVisible();
  await choose(nextStep(page).getByRole("radio", { name: "4 из 5" }));
  await nextStep(page).getByLabel("Отзыв").fill("Хороший шкаф, монтаж аккуратный.");
  await nextStep(page).getByRole("button", { name: "Отправить отзыв" }).click();
  await expect(page.getByText("Оценка: 4 из 5")).toBeVisible();
  await expect(nextStep(page).getByText("Сделка завершена. Спасибо!")).toBeVisible();
});
