import { expect, test, type Page } from "@playwright/test";
import { amount, choose, dealMoney, expectDealStatus, historyRow, loginAs, moneyBlock, nextStep, openDeal, openMoneyHistory, P } from "./support";
import { reseed } from "./support";

/**
 * Критерий ТЗ 3: спор на PAID_HOLD и на READY с каждым исходом решения оператора (ADR-009, раздел 3).
 * Сделки сида (mock-провайдер — операции проводятся сразу):
 *  - №4 PAID_HOLD, Айгерим ↔ Тимур (Исп. №6), шкаф 290 000 ₸;
 *  - №7 READY, Данияр ↔ ТОО «Ағаш Шебер» (Исп. №1), гардеробная 1 450 000 ₸.
 * Спор открывает покупатель в интерфейсе, мастер отвечает позицией, оператор решает. Перед каждым исходом — свежий сид.
 * Раздел — с суммой мастеру Y, у которой 4% и 2% дают тиыны: проверяем формулу на Y и возврат остатка до тиына.
 */

type Case = { status: "PAID_HOLD" | "READY"; deal: number; price: number; share: number; buyer: string; master: string; statusText: string };

const CASES: Case[] = [
  { status: "PAID_HOLD", deal: 4, price: 290_000, share: 100_001, buyer: P.aigerim, master: P.timur, statusText: "Оплачено, ждёт начала работ" },
  { status: "READY", deal: 7, price: 1_450_000, share: 725_333, buyer: P.daniyar, master: P.agash, statusText: "Работа сдана, ждёт приёмки" },
];

test.describe.configure({ mode: "serial" });
test.beforeEach(() => {
  test.setTimeout(240_000);
  reseed();
});

for (const c of CASES) {
  const X = dealMoney(c.price);

  test(`спор на ${c.status}: «Продолжить работу» — заморозка снята, сделка на том же шаге`, { tag: "@flow" }, async ({ page }) => {
    const dealPath = await openDisputeAsBuyer(page, c);
    await resolve(page, c.deal, { outcome: "Продолжить работу" });

    await loginAs(page, c.buyer);
    await page.goto(dealPath);
    await expectDealStatus(page, c.statusText);
    await expect(page.getByRole("region", { name: "Спор" })).toContainText("Спор решён");
    await expect(page.getByRole("region", { name: "Спор" })).toContainText("Продолжить работу");
    await expect(moneyBlock(page)).toContainText("под защитой банка");
    await expect(moneyBlock(page)).toContainText(amount(X.buyerTotal));
    if (c.status === "READY") await expect(nextStep(page).getByRole("link", { name: "Подписать акт" })).toBeVisible();

    const rows = await openMoneyHistory(page, dealPath);
    await expect(historyRow(rows, "Выплата удержана на время спора")).toContainText(amount(X.payout));
    await expect(historyRow(rows, "Удержание снято")).toContainText(amount(X.payout));
    await expect(historyRow(rows, "Возвращено покупателю")).toHaveCount(0);
    await expect(historyRow(rows, "Выплачено мастеру")).toHaveCount(0);

    await loginAs(page, c.master);
    await page.goto(dealPath);
    await expectDealStatus(page, c.statusText);
    if (c.status === "PAID_HOLD") await expect(nextStep(page).getByRole("button", { name: "Начать работу" })).toBeVisible();
    else await expect(nextStep(page).getByRole("link", { name: "Подписать акт ЭЦП" })).toBeVisible();
  });

  test(`спор на ${c.status}: «Полный возврат» — покупателю всё оплаченное, включая 2%`, { tag: "@flow" }, async ({ page }) => {
    const dealPath = await openDisputeAsBuyer(page, c);
    await resolve(page, c.deal, { outcome: "Полный возврат покупателю" });

    await loginAs(page, c.buyer);
    await page.goto(dealPath);
    await expectDealStatus(page, "Деньги возвращены");
    await expect(moneyBlock(page)).toContainText(`Деньги вернулись покупателю`);
    await expect(moneyBlock(page)).toContainText(amount(X.buyerTotal));
    const rows = await openMoneyHistory(page, dealPath);
    await expect(historyRow(rows, "Возвращено покупателю")).toHaveCount(1);
    await expect(historyRow(rows, "Возвращено покупателю")).toContainText(amount(X.buyerTotal));
    await expect(historyRow(rows, "Выплачено мастеру")).toHaveCount(0);

    await loginAs(page, c.master);
    await page.goto(dealPath);
    await expectDealStatus(page, "Деньги возвращены");
    await expect(moneyBlock(page)).toContainText(amount(X.buyerTotal));
  });

  test(`спор на ${c.status}: «Частичный раздел» — мастеру Y − 4%, покупателю остаток до тиына`, { tag: "@flow" }, async ({ page }) => {
    const Y = dealMoney(c.share);
    const refund = X.buyerTotal - Y.payout - Y.income;
    const dealPath = await openDisputeAsBuyer(page, c);
    await resolve(page, c.deal, { outcome: "Частичный раздел", share: c.share, expectPreview: { master: Y.payout, platform: Y.income, refund } });

    await loginAs(page, c.buyer);
    await page.goto(dealPath);
    await expectDealStatus(page, "Завершена");
    await expect(moneyBlock(page)).toContainText(amount(Y.payout));
    await expect(moneyBlock(page)).toContainText(amount(refund));
    const rows = await openMoneyHistory(page, dealPath);
    await expect(historyRow(rows, "Выплачено мастеру")).toContainText(amount(Y.payout));
    await expect(historyRow(rows, "Защита сделки и гарантия оплаты")).toContainText(amount(Y.income));
    await expect(historyRow(rows, "Возвращено покупателю")).toContainText(amount(refund));
    await expect(historyRow(rows, "Возвращено покупателю")).toHaveCount(1);

    await loginAs(page, c.master);
    await page.goto(dealPath);
    await expect(moneyBlock(page)).toContainText("Выплачено вам:");
    await expect(moneyBlock(page)).toContainText(amount(Y.payout));
  });
}

/** Покупатель открывает спор (с проверкой обязательного поля), мастер отправляет позицию. Возвращает адрес сделки. */
async function openDisputeAsBuyer(page: Page, c: Case): Promise<string> {
  await loginAs(page, c.buyer);
  const dealPath = await openDeal(page, c.deal);
  await expectDealStatus(page, c.statusText);
  await page.locator("summary", { hasText: "Открыть спор" }).click();
  const form = page.locator("details form");
  await form.getByLabel("Причина спора").selectOption({ label: c.status === "READY" ? "Качество работы" : "Сроки" });
  await form.getByLabel("Опишите ситуацию").fill("Коротко");
  await form.getByRole("button", { name: "Открыть спор" }).click();
  await expect(form.getByLabel("Опишите ситуацию")).toHaveAttribute("aria-invalid", "true");
  await form.getByLabel("Опишите ситуацию").fill("Мастер не выходит на связь третий день, сроки по оферте срываются.");
  await form.getByRole("button", { name: "Открыть спор" }).click();

  await expect(page.getByText("Открыт спор", { exact: true }).first()).toBeVisible();
  await expect(nextStep(page)).toContainText("Оператор рассматривает спор");
  await expect(moneyBlock(page)).toContainText("Выплата заморожена до решения спора");
  await expect(moneyBlock(page)).toContainText(amount(dealMoney(c.price).payout));

  await loginAs(page, c.master);
  await page.goto(dealPath);
  await expect(moneyBlock(page)).toContainText("Выплата заморожена до решения спора");
  await page.getByLabel("Ваша позиция").fill("Материалы задержал поставщик, работа идёт, фото пришлю завтра.");
  await page.getByRole("button", { name: "Отправить позицию" }).click();
  await expect(page.getByRole("region", { name: "Спор" })).toContainText("Материалы задержал поставщик");
  return dealPath;
}

/** Оператор решает спор: итог, сумма мастеру для раздела (и расчёт заранее), обоснование. */
async function resolve(page: Page, deal: number, o: { outcome: string; share?: number; expectPreview?: { master: bigint; platform: bigint; refund: bigint } }) {
  await loginAs(page, P.dinara);
  await page.goto("/operator/disputes");
  await page.getByRole("link", { name: new RegExp(`^Сделка №${deal}:`) }).click();
  await expect(page.getByRole("heading", { level: 1, name: `Спор по сделке №${deal}` })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Материалы задержал поставщик");
  await choose(page.getByRole("radio", { name: new RegExp(`^${o.outcome}`) }));
  if (o.share !== undefined) {
    await page.getByLabel("Сумма мастеру из цены, ₸").fill(String(o.share));
    await page.getByRole("button", { name: "Рассчитать раздел" }).click();
    const preview = page.getByRole("region", { name: "Расчёт" });
    if (o.expectPreview) {
      await expect(preview).toContainText(amount(o.expectPreview.master));
      await expect(preview).toContainText(amount(o.expectPreview.platform));
      await expect(preview).toContainText(amount(o.expectPreview.refund));
    }
  }
  await page.getByRole("button", { name: "Принять решение" }).click();
  await expect(page.getByLabel("Обоснование")).toHaveAttribute("aria-invalid", "true");
  await page.getByLabel("Обоснование").fill("Позиции сторон изучены, решение по фактам переписки и фото.");
  await page.getByRole("button", { name: "Принять решение" }).dblclick();
  await expect(page.getByRole("button", { name: "Принять решение" })).toHaveCount(0);
}
