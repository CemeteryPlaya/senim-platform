import { expect, test, type Page } from "@playwright/test";
import { bankBalance, pdfText } from "./pdf-text";
import {
  amount,
  captureAction,
  choose,
  confirmOperation,
  dealMoney,
  expectDealStatus,
  expectNoHorizontalScrollAt320And200,
  expectOnePrimary,
  historyRow,
  loginAs,
  moneyBlock,
  nextStep,
  openMoneyHistory,
  P,
  pendingOperations,
  phone,
  POINT,
  replay,
  reseed,
  signFromNextStep,
  stepAction,
  submitReady,
} from "./support";

/**
 * Критерий ТЗ 1 (+4, +5): полная сделка тремя участниками, каждый — в своём мобильном браузере (Pixel 7),
 * провайдер manual (PAYMENT_PROVIDER=manual у e2e-сервера). Только интерфейс: без dev-консоли и запросов в базу.
 * Заявка → отклик и торг со встречным раундом → принятие цены (двойной клик) → подписи оферты → оплата (двойной клик)
 * → оператор подтверждает HOLD документом (двойной клик) → «Начать работу» → сдача с фото и GPS у адреса →
 * подписи акта → оператор подтверждает раскрытие и выплаты → SPLIT_PAYOUT. На каждом шаге — что видит каждая сторона.
 * Суммы: X = 1 500 000 ₸ → покупатель 1 530 000 ₸, мастеру 1 440 000 ₸, доход платформы 90 000 ₸ (ТЗ п. 6).
 */

const X = 1_500_000;
const M = dealMoney(X);
const FIRST_PRICE = "1 600 000";
const COUNTER = "1 450 000";

test.beforeAll(() => {
  test.setTimeout(120_000);
  reseed();
});

test("полная сделка: покупатель, мастер и оператор в отдельных телефонах, manual-провайдер", { tag: "@flow" }, async ({ browser }, info) => {
  test.setTimeout(900_000);
  // Формула-оракул совпадает с примером ТЗ.
  expect([M.buyerTotal, M.payout, M.income]).toEqual([153_000_000n, 144_000_000n, 9_000_000n]);

  const buyerCtx = await phone(browser, info, POINT.demo12);
  const masterCtx = await phone(browser, info, POINT.demo12); // мастер сдаёт работу у адреса
  const operatorCtx = await phone(browser, info);
  const buyer = await buyerCtx.newPage();
  const master = await masterCtx.newPage();
  const operator = await operatorCtx.newPage();
  await loginAs(buyer, P.madina);
  await loginAs(master, P.erlan);
  await loginAs(operator, P.dinara);

  // ── 1. Заявка покупателя ──
  const requestTitle = await createKitchenRequest(buyer);
  const requestNumber = Number(requestTitle.match(/№(\d+)/)?.[1]);
  const requestPath = new URL(buyer.url()).pathname;

  // ── 2. Мастер видит тендер без адреса и откликается ценой ──
  await master.goto("/executor/requests");
  await master.getByRole("link", { name: new RegExp(`^Заявка №${requestNumber}:`) }).first().click();
  await expect(master.getByRole("heading", { level: 1, name: new RegExp(`^Заявка №${requestNumber}:`) })).toBeVisible();
  await expect(master.getByRole("main")).not.toContainText("ул. Демонстрационная");
  await master.getByLabel("Ваша цена, ₸").fill(FIRST_PRICE);
  // Зеркальный расчёт: мастер видит, сколько получит после приёмки, ещё до отправки.
  await expect(master.getByRole("main").getByRole("note").filter({ hasText: "Вы получите после приёмки" })).toContainText(amount(dealMoney(1_600_000).payout));
  await master.getByLabel("Срок изготовления, дней").fill("30");
  await master.getByLabel("Гарантия, месяцев").fill("24");
  await master.getByLabel("Комментарий заказчику").fill("Фасады МДФ в эмали, фурнитура Blum, верхние шкафы до потолка.");
  await stepAction(master).getByRole("button", { name: "Откликнуться", exact: true }).click();
  await expect(master.getByText("Отклик отправлен")).toBeVisible();
  const masterPrice = master.getByRole("region", { name: "Цена", exact: true });
  await expect(masterPrice.getByText("Ваша цена отправлена. Ждём ответа")).toBeVisible();

  // ── 3. Покупатель: отклик анонимно, встречная цена ──
  await buyer.goto(requestPath);
  const card = buyer.getByRole("article", { name: "Исполнитель №3" });
  await expect(card).toBeVisible();
  await expect(buyer.getByRole("main")).not.toContainText(/Жумабаев|Ерлан|700\s*000\s*02\s*01/);
  await card.getByRole("link", { name: /^Подробнее/ }).click();
  await expect(buyer.getByRole("heading", { level: 1, name: "Предложение Исполнителя №3" })).toBeVisible();
  const buyerPrice = buyer.getByRole("region", { name: "Цена", exact: true });
  await expect(buyerPrice.getByText(/^Мастер предлагает/)).toContainText(amount(160_000_000n));
  // Смета до оплаты: покупатель видит 2% сверху
  await expect(buyerPrice.getByRole("region", { name: "Смета до оплаты" })).toContainText(amount(dealMoney(1_600_000).buyerTotal));
  await buyerPrice.getByRole("button", { name: "Предложить свою цену" }).click();
  await buyerPrice.getByLabel("Ваша цена, ₸").fill(COUNTER);
  await buyerPrice.getByRole("button", { name: "Отправить цену" }).click();
  await expect(buyerPrice.getByText("Ваша цена отправлена. Ждём ответа")).toBeVisible();
  const offerPath = new URL(buyer.url()).pathname;

  // ── 4. Мастер: встречный раунд — 1 500 000 ₸ ──
  await master.reload();
  await expect(masterPrice.getByText(/^Покупатель предлагает/)).toContainText(amount(145_000_000n));
  // Мастеру смета — «К выплате» за вычетом 4%
  await expect(masterPrice.getByRole("region", { name: "Смета до оплаты" })).toContainText(amount(dealMoney(1_450_000).payout));
  await masterPrice.getByRole("button", { name: "Предложить свою цену" }).click();
  await masterPrice.getByLabel("Ваша цена, ₸").fill("1 500 000");
  await masterPrice.getByRole("button", { name: "Отправить цену" }).click();
  await expect(masterPrice.getByText("Ваша цена отправлена. Ждём ответа")).toBeVisible();

  // ── 5. Покупатель принимает цену двойным кликом: одна сделка ──
  await buyer.goto(offerPath);
  await expect(buyerPrice.getByRole("region", { name: "Смета до оплаты" })).toContainText(amount(M.buyerTotal));
  const accept = buyerPrice.getByRole("button", { name: /^Принять 1\s500\s000/ });
  await accept.dblclick();
  const acceptDialog = buyer.getByRole("dialog", { name: /^Принять цену/ });
  await expect(acceptDialog).toHaveCount(1);
  const acceptRequest = await captureAction(buyer, () => acceptDialog.getByRole("button", { name: "Да, принять" }).dblclick());
  await buyer.waitForURL(/\/deals\/[^/]+$/);
  await replay(buyer, acceptRequest); // повторный запрос «Принять цену» — второй сделки нет
  const dealPath = new URL(buyer.url()).pathname;
  const dealHeading = await buyer.getByRole("heading", { level: 1 }).textContent();
  const dealNumber = Number(dealHeading?.match(/^Сделка №(\d+)$/)?.[1]);
  expect(dealNumber, `заголовок сделки: ${dealHeading}`).toBeGreaterThan(17);
  await buyer.goto("/deals");
  await expect(buyer.getByRole("link", { name: `Открыть: Сделка №${dealNumber}`, exact: true })).toHaveCount(1);
  await expect(buyer.getByRole("link", { name: /^Открыть: Сделка №/ })).toHaveCount(3); // №2, №8 сида и новая

  // Оферта: смета у обеих сторон, контакты ещё скрыты
  await buyer.goto(dealPath);
  await expectDealStatus(buyer, "Оферта: подпись и оплата");
  const buyerEstimate = buyer.getByRole("region", { name: "Смета" });
  await expect(buyerEstimate).toContainText(amount(M.price));
  await expect(buyerEstimate).toContainText(amount(M.protection));
  await expect(buyerEstimate).toContainText(amount(M.buyerTotal));
  await expect(nextStep(buyer)).toContainText("Проверьте условия оферты и подпишите её");
  // Подпись оферты: заливная — только «Подписать оферту» в закреплённом слоте, панель подписи и чат вторичные.
  await expectOnePrimary(buyer);
  await master.goto(dealPath);
  const masterEstimate = master.getByRole("region", { name: "Смета" });
  await expect(masterEstimate).toContainText(amount(M.guarantee));
  await expect(masterEstimate).toContainText(amount(M.payout));
  await expect(master.getByRole("main")).not.toContainText(/700\s*000\s*01\s*03/); // телефон покупателя до оферты скрыт

  // ── 6. Подписи оферты: покупатель (двойные нажатия), затем мастер ──
  await signFromNextStep(buyer, "Подписать оферту", { doubleClick: true });
  await buyer.goto(dealPath);
  await expect(nextStep(buyer)).toContainText("Ждём подпись оферты другой стороной");
  await master.reload();
  await expect(nextStep(master)).toContainText("Проверьте условия оферты и подпишите её");
  await signFromNextStep(master, "Подписать оферту");
  await master.goto(dealPath);
  await expect(nextStep(master)).toContainText("Ждём оплату покупателя");
  await expect(master.getByRole("main")).toContainText(/700\s*000\s*01\s*03/); // после оферты контакты видны

  // ── 7. Оплата двойным кликом: одна операция HOLD в обработке ──
  await buyer.goto(dealPath);
  await expect(nextStep(buyer)).toContainText("Оферта заключена. Оплатите заказ");
  const pay = stepAction(buyer).getByRole("button", { name: /^Оплатить/ });
  await expect(pay).toContainText(amount(M.buyerTotal));
  const payRequest = await captureAction(buyer, () => pay.dblclick());
  await expect(moneyBlock(buyer)).toContainText("Оплата в обработке");
  await replay(buyer, payRequest); // повторная отправка «Оплатить» — та же операция HOLD
  await expect(nextStep(buyer)).toContainText("Банк подтверждает оплату");
  await expect(nextStep(buyer)).toContainText(amount(M.buyerTotal)); // «Переведите … по реквизитам из оферты»
  await master.reload();
  await expect(moneyBlock(master)).toContainText("Оплата в обработке");

  const holdOps = await pendingOperations(operator, dealNumber);
  await expect(holdOps).toHaveCount(1);
  await expect(holdOps.getByRole("heading", { name: "Оплата покупателя на эскроу-счёт" })).toBeVisible();
  await expect(holdOps).toContainText(amount(M.buyerTotal));

  // ── 8. Оператор подтверждает поступление документом (двойной клик) ──
  // Форма со сканом — multipart: Playwright не сохраняет тело с файлом для повтора, поэтому здесь — двойной клик.
  await confirmOperation(operator, { type: "Оплата покупателя на эскроу-счёт", deal: dealNumber, confirm: "Деньги поступили на счёт в банке", docNumber: "E2E-HOLD-1", doubleClick: true });
  await expect(await pendingOperations(operator, dealNumber)).toHaveCount(0);

  await buyer.goto(dealPath);
  await expectDealStatus(buyer, "Оплачено, ждёт начала работ");
  await expect(moneyBlock(buyer)).toContainText(amount(M.buyerTotal));
  await expect(moneyBlock(buyer)).toContainText("под защитой банка");
  await expect(nextStep(buyer)).toContainText("Мастер скоро начнёт работу");
  let rows = await openMoneyHistory(buyer, dealPath);
  await expect(rows).toHaveCount(1); // двойные клики «Оплатить» и «Подтвердить» — одна операция
  await expect(historyRow(rows, "Деньги зарезервированы в банке")).toContainText(amount(M.buyerTotal));
  await expect(historyRow(rows, "Деньги зарезервированы в банке")).toContainText("E2E-HOLD-1");

  await master.goto(dealPath);
  await expect(moneyBlock(master)).toContainText(`Деньги зарезервированы:`);
  await expect(moneyBlock(master)).toContainText(amount(M.payout));

  // ── 9. Мастер начинает работу ──
  await expect(nextStep(master)).toContainText("Деньги покупателя в банке — можно начинать работу");
  await stepAction(master).getByRole("button", { name: "Начать работу" }).dblclick();
  await expect(nextStep(master)).toContainText("Когда закончите, сдайте работу с фото результата");
  await buyer.goto(dealPath);
  await expectDealStatus(buyer, "Идут работы");
  await expect(nextStep(buyer)).toContainText("Мастер выполняет работу");

  // ── 10. Сдача с фото и GPS у адреса ──
  await master.reload();
  await submitReady(master);
  await expect(master.getByRole("region", { name: "Сдача работы" })).toContainText(/У адреса заказа \(\d+ м\)\./);
  await expect(nextStep(master)).toContainText("Работа сдана. Подпишите акт приёмки ЭЦП");

  await buyer.goto(dealPath);
  await expectDealStatus(buyer, "Работа сдана, ждёт приёмки");
  await expect(buyer.getByRole("region", { name: "Сдача работы" }).getByRole("img", { name: "Фото результата 1" })).toBeVisible();
  await expect(nextStep(buyer)).toContainText("Мастер сдал работу. Проверьте её и подпишите акт приёмки");

  // ── 11. Акт: мастер ЭЦП, покупатель — от руки и ЭЦП (порядок любой) ──
  await signFromNextStep(master, "Подписать акт ЭЦП", { expectHand: false });
  await master.goto(dealPath);
  await expect(nextStep(master)).toContainText("Покупатель проверяет работу");
  await buyer.reload();
  await signFromNextStep(buyer, "Подписать акт", { doubleClick: true });
  await buyer.goto(dealPath);
  await expectDealStatus(buyer, "Принято, идёт выплата");
  await expect(nextStep(buyer)).toContainText("Банк проводит выплату");

  // ── 12. Оператор: распоряжение о раскрытии и обе выплаты ──
  const payoutOps = await pendingOperations(operator, dealNumber);
  await expect(payoutOps).toHaveCount(3);
  await expect(operatorAmount(payoutOps, "Распоряжение о раскрытии")).toContainText(amount(M.buyerTotal));
  await expect(operatorAmount(payoutOps, "Выплата мастеру")).toContainText(amount(M.payout));
  await expect(operatorAmount(payoutOps, "Доход платформы")).toContainText(amount(M.income));
  await confirmOperation(operator, { type: "Распоряжение о раскрытии", deal: dealNumber, confirm: "Распоряжение о раскрытии передано в банк", docNumber: "E2E-REL-1" });
  await expect(await pendingOperations(operator, dealNumber)).toHaveCount(2);
  await confirmOperation(operator, { type: "Выплата мастеру", deal: dealNumber, confirm: "Выплачено мастеру", docNumber: "E2E-PAY-1", doubleClick: true });
  await expect(await pendingOperations(operator, dealNumber)).toHaveCount(1);
  await confirmOperation(operator, { type: "Доход платформы", deal: dealNumber, confirm: "Доход платформы получен", docNumber: "E2E-INC-1" });
  await expect(await pendingOperations(operator, dealNumber)).toHaveCount(0);

  // ── 13. SPLIT_PAYOUT: что видят стороны ──
  await buyer.goto(dealPath);
  await expectDealStatus(buyer, "Завершена");
  await expect(moneyBlock(buyer)).toContainText("Сделка завершена");
  await expect(moneyBlock(buyer)).toContainText(amount(M.payout));
  await expect(moneyBlock(buyer)).toContainText(amount(M.protection));
  await master.goto(dealPath);
  await expectDealStatus(master, "Завершена");
  await expect(moneyBlock(master)).toContainText("Выплачено вам:");
  await expect(moneyBlock(master)).toContainText(amount(M.payout));
  await expect(master.getByRole("main")).not.toContainText(/комисси|эскроу/i);
  await expect(buyer.getByRole("main")).not.toContainText(/комисси|эскроу/i);

  // ── Критерий 4: суммы до тиына в истории денег, выписке PDF, акте PDF и у оператора ──
  rows = await openMoneyHistory(buyer, dealPath);
  await expect(historyRow(rows, "Деньги зарезервированы в банке")).toContainText(amount(M.buyerTotal));
  await expect(historyRow(rows, "Выплачено мастеру")).toContainText(amount(M.payout));
  await expect(historyRow(rows, "Защита сделки и гарантия оплаты")).toContainText(amount(M.income));
  await expect(historyRow(rows, "Деньги зарезервированы в банке")).toHaveCount(1);
  await expect(historyRow(rows, "Выплачено мастеру")).toHaveCount(1);
  const statement = await pdfOf(buyer, buyer.getByRole("link", { name: "Выписка по сделке (PDF)" }));
  // Таблица «Операции» выписки (после «Суммы по оферте»): HOLD, раскрытие, выплата, доход; остаток в банке — 0
  const operations = statement.slice(statement.lastIndexOf("Операции"));
  for (const sum of [M.buyerTotal, M.payout, M.income]) expect(operations).toMatch(amount(sum));
  expect(bankBalance(operations)).toMatch(amount(0n));

  // «Финансы» мастера: выплата этой сделки — в списке выплат текущего месяца.
  await master.goto("/executor/finance");
  // Сумма — отдельным элементом строки (в textContent ссылки она слипается с датой «…2026»).
  const payoutRow = master.getByRole("region", { name: "Выплаты за месяц" }).getByRole("link", { name: new RegExp(`Сделка №${dealNumber},`) });
  await expect(payoutRow.getByText(amount(M.payout))).toBeVisible();

  const masterRows = await openMoneyHistory(master, dealPath);
  await expect(historyRow(masterRows, "Выплачено мастеру")).toContainText(amount(M.payout));

  await master.goto(dealPath);
  const actLink = master.getByRole("region", { name: /^Акт приёмки № / }).getByRole("link", { name: /^Открыть PDF/ });
  const act = await pdfOf(master, actLink);
  for (const sum of [M.price, M.protection, M.buyerTotal, M.guarantee, M.payout]) expect(act).toMatch(amount(sum));
  expect(act).toMatch(/в радиусе/);

  await operator.goto("/operator/deals");
  await operator.getByRole("link", { name: new RegExp(`^Сделка №${dealNumber}\\b`) }).first().click();
  const journal = operator.getByRole("main");
  for (const sum of [M.buyerTotal, M.payout, M.income]) await expect(journal).toContainText(amount(sum));
  await expect(journal).toContainText("E2E-HOLD-1");
  await expect(journal).toContainText("E2E-PAY-1");

  await Promise.all([buyerCtx.close(), masterCtx.close(), operatorCtx.close()]);
});

/** Месяц по времени Казахстана (UTC+5), как в deal-core.monthOf: «2026-11» и заголовок «Ноябрь 2026». */
function kzMonth(shift = 0): { ym: string; title: RegExp } {
  const local = new Date(Date.now() + 5 * 3600 * 1000);
  const d = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + shift, 1));
  const names = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
  return { ym: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`, title: new RegExp(`^${names[d.getUTCMonth()]} ${d.getUTCFullYear()}$`) };
}

test("финансы мастера: месяц переключается стрелками, столбики по месяцам, ожидает выплаты", async ({ page }) => {
  await loginAs(page, P.timur); // Исп. №6: выплаты по №12 и №17, деньги №4 в банке до приёмки
  await page.goto("/executor/finance");
  const main = page.getByRole("main");
  const now = kzMonth();
  const before = kzMonth(-1);
  await expect(main.getByRole("heading", { level: 2, name: now.title })).toBeVisible();
  // Будущих месяцев нет: на текущем — только стрелка назад.
  await expect(main.getByRole("link", { name: "Следующий месяц" })).toHaveCount(0);
  await expect(main.getByRole("list", { name: "Выплаты по месяцам" }).getByRole("listitem")).toHaveCount(6);
  await expect(main.getByRole("note").filter({ hasText: "Ожидает выплаты после приёмки" })).toContainText("деньги в банке под защитой");

  await main.getByRole("link", { name: "Предыдущий месяц" }).click();
  await page.waitForURL(new RegExp(`/executor/finance\\?month=${before.ym}$`));
  await expect(main.getByRole("heading", { level: 2, name: before.title })).toBeVisible();
  await main.getByRole("link", { name: "Следующий месяц" }).click();
  await page.waitForURL(new RegExp(`/executor/finance\\?month=${now.ym}$`));
  await expect(main.getByRole("heading", { level: 2, name: now.title })).toBeVisible();

  // Неверный месяц в адресе — текущий; будущий — тоже текущий.
  await page.goto("/executor/finance?month=2026-13");
  await expect(main.getByRole("heading", { level: 2, name: now.title })).toBeVisible();
  await page.goto(`/executor/finance?month=${kzMonth(2).ym}`);
  await expect(main.getByRole("heading", { level: 2, name: now.title })).toBeVisible();

  await expect(main.locator("[data-primary-action]")).toHaveCount(0);
  await expect(main).not.toContainText(/комисси|эскроу/i);
  await expectNoHorizontalScrollAt320And200(page, "/executor/finance");
});

/** Мастер заявки до отправки: кухня, Комфорт, точка на карте — место телефона покупателя. Возвращает заголовок заявки. */
async function createKitchenRequest(page: Page): Promise<string> {
  await page.goto("/requests/new");
  await expect(page.getByRole("heading", { level: 1, name: "Что делаем и в каком стиле?" })).toBeVisible();
  await choose(page.getByRole("group", { name: "Что заказать" }).getByRole("radio", { name: "Кухня", exact: true }));
  await page.getByRole("button", { name: "Далее" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Какой уровень?" })).toBeVisible();
  await choose(page.getByRole("radio", { name: /^Комфорт/ }));
  await page.getByRole("button", { name: "Далее" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Фото и описание" })).toBeVisible();
  await page.getByLabel("Опишите своими словами").fill("Кухня 3 м до потолка, нужна посудомойка");
  await page.getByRole("button", { name: "Далее" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Где и когда" })).toBeVisible();
  await page.getByLabel("Город").fill("Астана");
  await page.getByLabel("Адрес или район").fill("Астана, ул. Демонстрационная, 12, кв. 45");
  await page.getByRole("button", { name: "Указать моё местоположение" }).click();
  await expect(page.getByText(/^Точка указана: /)).toBeVisible();
  await page.getByRole("button", { name: "Далее" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Проверьте и отправьте" })).toBeVisible();
  await page.getByRole("button", { name: "Отправить заявку" }).click();
  await page.waitForURL(/\/requests\/[^/]+\?sent=1$/);
  await expect(page.getByText("Заявка отправлена")).toBeVisible();
  const title = (await page.getByRole("heading", { level: 1 }).textContent()) ?? "";
  expect(title).toMatch(/^Заявка №\d+: Кухня$/);
  return title;
}

function operatorAmount(cards: ReturnType<Page["getByRole"]>, type: string) {
  return cards.filter({ has: cards.page().getByRole("heading", { name: type, exact: true }) });
}

/** PDF по ссылке на экране — тем же сеансом браузера; текст — через pdfText. */
async function pdfOf(page: Page, link: ReturnType<Page["getByRole"]>): Promise<string> {
  const href = await link.getAttribute("href");
  if (!href) throw new Error("Нет ссылки на PDF");
  const res = await page.request.get(href);
  expect(res.status(), href).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/pdf");
  return pdfText(await res.body());
}
