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

/** Окно подтверждения необратимого действия: одно открытое окно с вопросом, кнопка согласия. */
async function confirmIn(page: Page, title: string, yes: string) {
  const dialog = page.getByRole("dialog", { name: title });
  await expect(dialog).toHaveCount(1);
  await dialog.getByRole("button", { name: yes }).click();
  await expect(dialog).toBeHidden();
}

/** Подписать акт из «Что дальше» и вернуться на свежий экран сделки. */
async function signAct(page: Page, dealPath: string, expected: "Подпись принята" | "Документ подписан обеими сторонами") {
  await expect(nextStep(page).getByText(/^Подпишите акт по этапу «/)).toBeVisible();
  const panel = await signFromNextStep(page);
  await expect(panel.getByText(expected)).toBeVisible();
  await page.goto(dealPath);
}

test("двойное нажатие «Принять этап» оставляет окно подтверждения открытым", async ({ page }) => {
  // Дефект (см. отчёт QA): второй клик двойного нажатия попадает в затемнение только что открытого
  // <dialog> и закрывает окно (src/ui/Modal.tsx, onClick по затемнению). Приёмки при этом нет — это проверяем первым.
  test.fail(true, "двойное нажатие открывает и сразу закрывает окно подтверждения");
  await loginAs(page, P.aigerim);
  await openDeal(page, 11);
  await nextStep(page).getByRole("button", { name: "Принять этап" }).dblclick();
  await expect(stage(page, 2).getByText("Сдан, ждёт приёмки")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Принять этап?" })).toBeVisible({ timeout: 2_000 });
});

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

  // Приёмку подтверждают одновременно из двух вкладок: эффект должен быть один
  const second = await page.context().newPage();
  await second.goto(dealPath);
  for (const p of [page, second]) {
    await nextStep(p).getByRole("button", { name: "Принять этап" }).click();
    await expect(p.getByRole("dialog", { name: "Принять этап?" })).toBeVisible();
  }
  await Promise.all([page, second].map((p) => p.getByRole("dialog", { name: "Принять этап?" }).getByRole("button", { name: "Да, принять этап" }).click()));
  // Одна вкладка приняла этап, вторая получила отказ «действие недоступно» без второй приёмки
  const refused = (p: Page) => nextStep(p).getByRole("alert").filter({ hasText: "Сейчас это действие недоступно" });
  const acceptedIn = (p: Page) => stage(p, 2).getByText("Принят", { exact: true });
  await expect(refused(page).or(acceptedIn(page)).first()).toBeVisible();
  await expect(refused(second).or(acceptedIn(second)).first()).toBeVisible();
  expect((await refused(page).count()) + (await refused(second).count())).toBe(1);
  await second.close();
  await page.goto(dealPath);
  await expect(acceptedIn(page)).toBeVisible();
  // Ни второй приёмки, ни второго акта
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
  // Ждём конец загрузки: пока идёт загрузка, «Сдать этап» отвечает «Добавьте хотя бы одно фото» (см. отчёт QA)
  await expect(nextStep(page).getByRole("progressbar")).toHaveCount(0);
  await nextStep(page).getByRole("button", { name: "Сдать этап" }).click();
  await expect(stage(page, 3).getByText("Сдан, ждёт приёмки")).toBeVisible();

  // ── Заказчик: приёмка этапа 3, акт, отметка оплаты ──
  await loginAs(page, P.aigerim);
  await page.goto(dealPath);
  await expect(stage(page, 3).getByText("Шкаф установлен, фасады отрегулированы, мусор вывезен.")).toBeVisible();
  await nextStep(page).getByRole("button", { name: "Принять этап" }).click();
  await confirmIn(page, "Принять этап?", "Да, принять этап");
  await expect(stage(page, 3).getByText("Принят", { exact: true })).toBeVisible();
  await signAct(page, dealPath, "Подпись принята");
  await expect(nextStep(page).getByText(/^Оплатите этап «.+» исполнителю и отметьте оплату здесь\.$/)).toBeVisible();
  await nextStep(page).getByRole("button", { name: "Я оплатил" }).click();
  await confirmIn(page, "Вы уже оплатили этап?", "Да, я оплатил");
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
