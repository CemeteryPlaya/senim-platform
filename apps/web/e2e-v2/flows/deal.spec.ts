import { devices, expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { ru } from "@/i18n/ru";
import { confirmOperation, loginAs, P, phone as phoneContext, POINT, signFromNextStep, stepAction, submitReady } from "../../e2e/support";
import { seedBuyerState } from "../offers";
import { assertSafeDatabase } from "../safe-database";
import { open } from "../support";

/**
 * Полная сделка покупателя в v2 (набор flows: база e2e пересеяна перед прогоном, данные меняются). Засеянная Айгерим и
 * «Прихожая» (оферта не подписана, мастер — Ерлан, провайдер оплаты стенда — manual): покупатель в v2 подписывает оферту
 * (от руки ФИО и ЭЦП мок-провайдера, двойные нажатия), мастер в v1 даёт согласие банку и подписывает оферту, покупатель в
 * v2 даёт согласие и оплачивает (двойное нажатие — одна операция HOLD), оператор в v1 подтверждает поступление, мастер в v1
 * начинает работу, сдаёт её у адреса и подписывает акт ЭЦП, покупатель в v2 принимает мебель подписью акта, оператор
 * подтверждает раскрытие и выплаты — сделка завершена. Вид компьютера проверяет второй контекст в конце.
 *
 * Сделка сида одна на пересев, поэтому сценарий идёт только в проекте flows-mobile (в flows-desktop — явный пропуск):
 * от порядка проектов он не зависит. Покупатель входит через identity один раз (состояние во временной папке ОС); мастер
 * и оператор — демо-входом v1 (DEMO_MODE сервера e2e), кодов SMS это не тратит.
 */

const t = ru.app.deal;
const now = t.card.now;
const DEAL_TITLE = "Прихожая";

function databaseUrl(): string {
  const url = process.env.E2E_DATABASE_URL ?? "";
  assertSafeDatabase(url);
  return url;
}

/** Только чтение базы e2e: подписи покупателя на документе и операции HOLD сделки. */
async function facts(dealId: string): Promise<{ holds: number; holdPending: boolean; hand: Record<string, number>; ecp: Record<string, number> }> {
  const client = new Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    const holds = await client.query<{ n: string; pending: string }>(
      `select count(*)::text as n, count(*) filter (where status = 'PENDING')::text as pending from "MoneyTransaction" where "dealId" = $1 and type = 'HOLD'`,
      [dealId],
    );
    const hand = await client.query<{ kind: string; n: string }>(
      `select d.kind, count(*)::text as n from "HandSignature" s join "Document" d on d.id = s."documentId" where d."dealId" = $1 and s.party = 'CLIENT' group by d.kind`,
      [dealId],
    );
    const ecp = await client.query<{ kind: string; n: string }>(
      `select d.kind, count(*)::text as n from "Signature" s join "Document" d on d.id = s."documentId" where d."dealId" = $1 and s.party = 'CLIENT' group by d.kind`,
      [dealId],
    );
    const byKind = (rows: { kind: string; n: string }[]) => Object.fromEntries(rows.map((r) => [r.kind, Number(r.n)]));
    return { holds: Number(holds.rows[0]?.n ?? 0), holdPending: Number(holds.rows[0]?.pending ?? 0) > 0, hand: byKind(hand.rows), ecp: byKind(ecp.rows) };
  } finally {
    await client.end();
  }
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Заголовок «Сейчас» карточки сделки — один из `titles`. */
const nowHeading = (page: Page, titles: readonly string[]) => page.getByRole("heading", { level: 2, name: new RegExp(`^(${titles.map(escape).join("|")})$`) });

/** Карточка сделки v2: «Сейчас» — один из ожидаемых заголовков. */
async function expectNow(page: Page, dealPath: string, titles: readonly string[]): Promise<void> {
  await open(page, dealPath);
  await expect(page.locator("h1")).toHaveText(DEAL_TITLE);
  await expect(nowHeading(page, titles)).toBeVisible();
}

/** Подпись документа покупателем на экране v2: шаг 1 — ФИО вводом, шаг 2 — ЭЦП (мок eGov QR); двойные нажатия. */
async function signInV2(page: Page, title: string, toast: string): Promise<void> {
  await expect(page.locator("h1")).toHaveText(title);
  await expect(page.locator("main")).toContainText(t.sign.stepOf(1, 2));
  await page.getByRole("button", { name: ru.app.kit.signature.typeName }).click();
  await page.getByLabel(ru.app.kit.signature.nameLabel).fill("Сапарова Айгерим");
  await page.locator("[data-primary-action]").dblclick();
  await expect(page.locator("main")).toContainText(t.sign.stepOf(2, 2), { timeout: 30_000 });
  // Покупатель — на телефоне: способ ЭЦП один (eGov Mobile), выбора нет — строка о том, чем подписывать.
  await expect(page.getByText(t.sign.ecp.phoneMethod)).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(0);
  await page.locator("[data-primary-action]").click();
  await expect(page.getByRole("img", { name: t.sign.ecp.qrAlt })).toBeVisible();
  await page.locator("[data-primary-action]").dblclick();
  await page.waitForURL(/\/v2\/deals\/[^/?#]+$/, { timeout: 30_000 });
  await expect(page.getByText(toast, { exact: true })).toBeVisible();
}

test("полная сделка покупателя в v2: оферта → оплата → работа мастера → приёмка подписью акта → завершена", async ({ browser }, info) => {
  test.skip(info.project.name !== "flows-mobile", "сделка сида одна на пересев: сценарий — в flows-mobile, вид компьютера — вторым контекстом в нём же");
  test.setTimeout(900_000);
  const baseURL = info.project.use.baseURL;
  const storageState = await seedBuyerState(browser, baseURL, "deal-flow.json");
  const buyerCtx = await browser.newContext({ ...devices["Pixel 7"], baseURL, locale: "ru-RU", timezoneId: "Asia/Almaty", storageState });
  const masterCtx = await phoneContext(browser, info, POINT.demo12); // мастер сдаёт работу у адреса «Прихожей»
  const operatorCtx = await phoneContext(browser, info);
  const buyer = await buyerCtx.newPage();
  const master = await masterCtx.newPage();
  const operator = await operatorCtx.newPage();
  await loginAs(master, P.erlan);
  await loginAs(operator, P.dinara);

  // ── 1. Покупатель: карточка сделки → «Подписать оферту» → подпись от руки и ЭЦП ──
  await open(buyer, "/v2/deals?group=active");
  const dealPath = await buyer.locator("main a[href^='/v2/deals/']").filter({ hasText: DEAL_TITLE }).first().getAttribute("href");
  if (!dealPath) throw new Error(`Сделка «${DEAL_TITLE}» не найдена: нужен пересев (E2E_FLOWS=1)`);
  const dealId = dealPath.split("/").at(-1) ?? "";
  await expectNow(buyer, dealPath, [now.signOffer.title]);
  const lead = (await buyer.getByRole("main").getByText(/^Сделка №\d+/).first().textContent()) ?? "";
  const dealNumber = Number(lead.match(/№(\d+)/)?.[1]);
  expect(dealNumber, `строка под заголовком: ${lead}`).toBeGreaterThan(0);
  await buyer.locator("[data-primary-action]").click();
  await buyer.waitForURL(/\/sign\//);
  await signInV2(buyer, t.sign.title.CONTRACT, t.sign.signed.CONTRACT);
  await expect(nowHeading(buyer, [now.waitOffer.title])).toBeVisible();
  expect((await facts(dealId)).hand.CONTRACT).toBe(1);
  expect((await facts(dealId)).ecp.CONTRACT).toBe(1);

  // ── 2. Мастер в v1: согласие банку и подпись оферты ──
  await master.goto(`/deals/${dealId}`);
  await signFromNextStep(master, "Подписать оферту");

  // ── 3. Покупатель: оплата — согласие банку и «Оплатить» двойным нажатием: одна операция ──
  await expectNow(buyer, dealPath, [now.pay.title]);
  await buyer.locator("[data-primary-action]").click();
  await buyer.waitForURL(/\/pay$/);
  await expect(buyer.locator("h1")).toHaveText(t.pay.title);
  const pay = buyer.locator("[data-primary-action]");
  // Провайдер стенда — ручной (перевод по реквизитам оферты); онлайн-провайдер — «Оплатить N ₸».
  await expect(pay).toHaveText(/^Оплатить (переводом )?\d/);
  // После пересева своего согласия банку у Айгерим по «Прихожей» нет: текст согласия, отметка, кнопка отключена до отметки.
  await expect(buyer.getByRole("region", { name: t.pay.consent.textLabel })).toBeVisible();
  const agree = buyer.getByRole("checkbox", { name: t.pay.consent.agree });
  await expect(agree).not.toBeChecked();
  await expect(pay).toBeDisabled();
  await buyer.getByText(t.pay.consent.agree, { exact: true }).click();
  await expect(agree).toBeChecked();
  await expect(pay).toBeEnabled();
  await pay.dblclick();
  await buyer.waitForURL(/\/v2\/deals\/[^/?#]+$/, { timeout: 30_000 });
  await expect(buyer.getByText(new RegExp(`^(${t.pay.manual.done}|${t.pay.done.PENDING}|${t.pay.done.SUCCEEDED})$`)).first()).toBeVisible();
  expect((await facts(dealId)).holds).toBe(1);
  // Повторно на экран оплаты не попасть: он уводит на карточку («ждём подтверждения»).
  await open(buyer, `${dealPath}/pay`);
  await expect(buyer).toHaveURL(new RegExp(`${dealPath}$`));
  await expect(buyer.locator("[data-primary-action]").filter({ hasText: /^Оплатить/ })).toHaveCount(0);

  // ── 4. Оператор в v1 (manual): деньги поступили в банк ──
  if ((await facts(dealId)).holdPending) {
    await confirmOperation(operator, { type: "Оплата покупателя на эскроу-счёт", deal: dealNumber, confirm: "Деньги поступили на счёт в банке", docNumber: "E2E-V2-HOLD" });
  }
  await expectNow(buyer, dealPath, [now.waitStart.title]);

  // ── 5. Мастер в v1: начинает работу, сдаёт у адреса, подписывает акт ЭЦП ──
  await master.goto(`/deals/${dealId}`);
  await stepAction(master).getByRole("button", { name: "Начать работу" }).click();
  await expect(stepAction(master).getByRole("button", { name: "Начать работу" })).toHaveCount(0);
  await master.reload();
  await submitReady(master);
  await signFromNextStep(master, "Подписать акт ЭЦП", { expectHand: false });

  // ── 6. Покупатель: «Принять мебель» → подпись акта от руки и ЭЦП ──
  await expectNow(buyer, dealPath, [now.accept.title]);
  await buyer.locator("[data-primary-action]").click();
  await buyer.waitForURL(/\/sign\//);
  await expect(buyer.locator("main")).toContainText(t.sign.act.meaning);
  await signInV2(buyer, t.sign.title.ACCEPTANCE_ACT, t.sign.signed.ACCEPTANCE_ACT);
  expect((await facts(dealId)).hand.ACCEPTANCE_ACT).toBe(1);
  expect((await facts(dealId)).ecp.ACCEPTANCE_ACT).toBe(1);

  // ── 7. Оператор (manual): раскрытие и обе выплаты → сделка завершена ──
  await open(buyer, dealPath);
  await expect(buyer.locator("[data-primary-action]").filter({ hasText: now.accept.action })).toHaveCount(0);
  if (!(await nowHeading(buyer, [now.done.title, now.review.title]).isVisible())) {
    await confirmOperation(operator, { type: "Распоряжение о раскрытии", deal: dealNumber, confirm: "Распоряжение о раскрытии передано в банк", docNumber: "E2E-V2-REL" });
    await confirmOperation(operator, { type: "Выплата мастеру", deal: dealNumber, confirm: "Выплачено мастеру", docNumber: "E2E-V2-PAY" });
    await confirmOperation(operator, { type: "Доход платформы", deal: dealNumber, confirm: "Доход платформы получен", docNumber: "E2E-V2-INC" });
  }
  await expectNow(buyer, dealPath, [now.done.title, now.review.title]);
  await expect(buyer.locator("main")).toContainText(t.status.done);
  expect((await facts(dealId)).holds).toBe(1);
  await Promise.all([buyerCtx.close(), masterCtx.close(), operatorCtx.close()]);

  // ── Вид компьютера: та же сделка завершена; экраны подписи и оплаты уводят на карточку ──
  const desktop = await browser.newContext({ ...devices["Desktop Chrome"], baseURL, locale: "ru-RU", timezoneId: "Asia/Almaty", storageState });
  const screen = await desktop.newPage();
  await expectNow(screen, dealPath, [now.done.title, now.review.title]);
  await open(screen, `${dealPath}/pay`);
  await expect(screen).toHaveURL(new RegExp(`${dealPath}$`));
  await desktop.close();
});
