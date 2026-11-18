import { devices, expect, test, type Page } from "@playwright/test";
import { ru } from "@/i18n/ru";
import { seedBuyerState } from "../offers";
import { open } from "../support";

/**
 * Спор и возврат покупателя в v2 (набор flows: база e2e пересеяна перед прогоном, данные меняются). Засеянная Айгерим:
 * «Кухня» (работа идёт, деньги в банке) — покупатель открывает спор, видит «Спор рассматривает оператор», выплату
 * приостановленной и строку «выплата приостановлена» в истории денег; «Шкаф-купе» (оплачен, работа не начата) — покупатель
 * отменяет сделку, деньги возвращаются, а в истории денег появляется строка возврата.
 *
 * Сделки сида одни на пересев, поэтому сценарий идёт только в проекте flows-mobile (в flows-desktop — явный пропуск):
 * от порядка проектов и от других сценариев набора он не зависит (свои сделки, свой вход). Вид компьютера проверяет второй
 * контекст в конце. Покупатель входит через identity один раз (состояние во временной папке ОС).
 */

const t = ru.app.deal;
const dispute = t.dispute;
const card = t.card;

/** Адрес сделки из списка по названию заказа. */
async function dealHref(page: Page, title: string): Promise<string> {
  await open(page, "/v2/deals?group=active");
  const href = await page.locator("main a[href^='/v2/deals/']").filter({ hasText: title }).first().getAttribute("href");
  if (!href) throw new Error(`Сделка «${title}» не найдена: нужен пересев (E2E_FLOWS=1)`);
  return href;
}

test("покупатель открывает спор по сделке в работе и отменяет оплаченную сделку с возвратом", async ({ browser }, info) => {
  test.skip(info.project.name !== "flows-mobile", "сделки сида одни на пересев: сценарий — в flows-mobile, вид компьютера — вторым контекстом в нём же");
  test.setTimeout(600_000);
  const baseURL = info.project.use.baseURL;
  const storageState = await seedBuyerState(browser, baseURL, "dispute-flow.json");
  const mobile = await browser.newContext({ ...devices["Pixel 7"], baseURL, locale: "ru-RU", timezoneId: "Asia/Almaty", storageState });
  const page = await mobile.newPage();

  // ── 1. Спор по «Кухне»: форма → подтверждение → карточка с тостом ──
  const kitchen = await dealHref(page, "Кухня");
  await open(page, `${kitchen}/dispute`);
  await expect(page.locator("h1")).toHaveText(dispute.form.title);
  await page.getByText(dispute.reasons.QUALITY, { exact: true }).click();
  await page.getByLabel(dispute.form.descriptionLabel).fill("Дверцы шкафов перекошены, зазоры разные, ящики ходят туго");
  await page.locator("[data-primary-action]").click();
  const confirm = page.getByRole("dialog", { name: dispute.form.confirm.title });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText(dispute.form.confirm.body);
  await expect(confirm.getByRole("button", { name: dispute.form.confirm.cancel })).toBeFocused();
  // Двойное нажатие на подтверждение: спор один.
  await confirm.getByRole("button", { name: dispute.form.confirm.confirm }).dblclick();
  await page.waitForURL(new RegExp(`${kitchen}$`), { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 2, name: card.now.dispute.title })).toBeVisible();
  await expect(page.locator("main")).toContainText(card.money.frozen.title);

  // ── 2. Экран спора: состояние, форма позиции; повторно открыть спор нельзя ──
  await open(page, `${kitchen}/dispute`);
  await expect(page.locator("h1")).toHaveText(dispute.open.title);
  await expect(page.getByRole("heading", { level: 2, name: dispute.open.now.title })).toBeVisible();
  await expect(page.locator("main")).toContainText(dispute.open.now.body);
  await expect(page.locator("main")).toContainText(dispute.reasons.QUALITY);
  await expect(page.getByLabel(dispute.open.positionForm.label)).toBeVisible();

  // ── 3. История денег «Кухни»: оплата и приостановка выплаты ──
  await open(page, `${kitchen}/money`);
  const operations = page.getByRole("list", { name: t.money.operationsLabel });
  await expect(operations.getByText(t.money.type.HOLD)).toBeVisible();
  await expect(operations.getByText(t.money.type.FREEZE)).toBeVisible();

  // ── 4. Отмена оплаченной «Шкаф-купе»: возврат, строка возврата в истории денег ──
  const wardrobe = await dealHref(page, "Шкаф-купе");
  await open(page, wardrobe);
  await page.getByRole("button", { name: card.actions.menu }).click();
  await page.getByText(card.actions.cancel, { exact: true }).first().click();
  const cancel = page.getByRole("dialog", { name: card.actions.cancelTitle });
  await expect(cancel).toBeVisible();
  await cancel.getByRole("button", { name: card.actions.cancel }).click();
  // Итог — на экране истории денег (тост исчезает): провайдер стенда ручной, возврат ждёт отметки оператора.
  // Адрес карточки уже открыт до отмены — ждём закрытия окна, а строку возврата — перечитывая историю денег.
  await expect(cancel).toBeHidden({ timeout: 30_000 });
  const wardrobeOps = page.getByRole("list", { name: t.money.operationsLabel });
  const refundRow = wardrobeOps.getByText(new RegExp(`^(${t.money.type.REFUND}|${t.money.refundState.PENDING})$`));
  await expect(async () => {
    await open(page, `${wardrobe}/money`);
    await expect(refundRow).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  await expect(wardrobeOps.getByText(t.money.type.HOLD)).toBeVisible();
  // «Сейчас» на карточке — про возврат или отмену, а не про оплату. Возврат по сделке с офертой — окончание сделки: когда
  // банк вернул деньги (мок стенда — сразу), покупателю предлагается отзыв (спека 2026-11-17, 3.4; флаг reviews включён).
  await open(page, wardrobe);
  const after = [card.now.waitRefund.title, card.now.refunded.title, card.now.cancelled.title, card.now.review.title];
  await expect(page.getByRole("heading", { level: 2, name: new RegExp(`^(${after.join("|")})$`) })).toBeVisible();
  await expect(page.locator('[data-primary-action][href$="/pay"]')).toHaveCount(0);
  await open(page, `${wardrobe}/money`);
  await expect(page.locator("main")).not.toContainText(/комисси|эскроу|тестов|демо|платформ/i);

  // ── 5. Вид компьютера: спор и история денег ──
  const desktop = await browser.newContext({ ...devices["Desktop Chrome"], baseURL, locale: "ru-RU", timezoneId: "Asia/Almaty", storageState });
  const wide = await desktop.newPage();
  await open(wide, `${kitchen}/dispute`);
  await expect(wide.locator("h1")).toHaveText(dispute.open.title);
  await open(wide, `${kitchen}/money`);
  await expect(wide.getByRole("list", { name: t.money.operationsLabel }).getByText(t.money.type.FREEZE)).toBeVisible();
  await desktop.close();
  await mobile.close();
});
