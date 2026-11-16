import { devices, expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { ru } from "@/i18n/ru";
import sharp from "sharp";
import { formatDays } from "@/features/format/format";
import { loginAs, P, phone as phoneContext, POINT } from "../../e2e/support";
import { OPERATOR_TOTP_SECRET } from "@/seed/data";
import { confirmOperationV2 } from "../operator-support";
import { seedBuyerState } from "../offers";
import { assertSafeDatabase } from "../safe-database";
import { open } from "../support";

/**
 * Полная сделка в v2 — обе стороны работают в новом интерфейсе (набор flows: база e2e пересеяна перед прогоном, данные
 * меняются). Засеянная Айгерим и «Прихожая» (оферта не подписана, мастер — Ерлан, провайдер оплаты стенда — manual):
 * покупатель в v2 подписывает оферту (от руки ФИО и ЭЦП мок-провайдера, двойные нажатия); мастер в v2 подписывает оферту —
 * без отметки согласия для банка подпись закрыта, с ней — от руки и ЭЦП; покупатель в v2 даёт согласие и оплачивает
 * (двойное нажатие — одна операция HOLD), оператор в v1 подтверждает поступление; мастер в v2 начинает работу
 * (подтверждение, двойное нажатие — один переход), добавляет отчёт о ходе работ (покупатель видит его на карточке), сдаёт
 * работу с фото — сначала без разрешения на геолокацию (честный отказ, сдача не начата), затем у адреса с отметкой места —
 * и подписывает акт ЭЦП; покупатель в v2 принимает мебель подписью акта, оператор подтверждает раскрытие и выплаты — сделка
 * завершена. Вид компьютера проверяет второй контекст в конце.
 *
 * Сделка сида одна на пересев, поэтому сценарий идёт только в проекте flows-mobile (в flows-desktop — явный пропуск):
 * от порядка проектов он не зависит. Покупатель входит через identity один раз (состояние во временной папке ОС); мастер
 * и оператор — входом v1 (код с экрана; у оператора ещё код из приложения по секрету сида). Геолокацию мастера задаёт контекст
 * Playwright: `geolocation` и `permissions: ["geolocation"]` (у адреса «Прихожей»); второй контекст мастера — без разрешения.
 */

const t = ru.app.deal;
const now = t.card.now;
const ms = ru.app.masterSteps;
const mnow = ru.app.master.deal.now;
const DEAL_TITLE = "Прихожая";

function databaseUrl(): string {
  const url = process.env.E2E_DATABASE_URL ?? "";
  assertSafeDatabase(url);
  return url;
}

/** Только чтение базы e2e: подписи сторон на документах, операции HOLD и переходы мастера сделки. */
/** Срок изготовления по сделке из базы: текст подтверждения «Начать работу» называет его, а сид может меняться. */
async function dealDays(dealId: string): Promise<number> {
  const client = new Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    const row = await client.query<{ days: number }>(`select "durationDays" as days from "Deal" where id = $1`, [dealId]);
    const days = row.rows[0]?.days;
    if (days === undefined) throw new Error(`Сделка ${dealId} не найдена — нужен пересев`);
    return days;
  } finally {
    await client.end();
  }
}

async function facts(
  dealId: string,
): Promise<{
  holds: number;
  holdPending: boolean;
  hand: Record<string, number>;
  ecp: Record<string, number>;
  masterHand: Record<string, number>;
  masterEcp: Record<string, number>;
  events: Record<string, number>;
}> {
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
    // Подписи мастера (сторона EXECUTOR): оферта — от руки и ЭЦП, акт — только ЭЦП.
    const masterHand = await client.query<{ kind: string; n: string }>(
      `select d.kind, count(*)::text as n from "HandSignature" s join "Document" d on d.id = s."documentId" where d."dealId" = $1 and s.party = 'EXECUTOR' group by d.kind`,
      [dealId],
    );
    const masterEcp = await client.query<{ kind: string; n: string }>(
      `select d.kind, count(*)::text as n from "Signature" s join "Document" d on d.id = s."documentId" where d."dealId" = $1 and s.party = 'EXECUTOR' group by d.kind`,
      [dealId],
    );
    // Переходы мастера (аудит сделки): двойное нажатие не даёт второго «начал работу» и второй «сдачи».
    const events = await client.query<{ kind: string; n: string }>(
      `select action as kind, count(*)::text as n from "AuditEvent" where scope = $1 and action in ('deal.started', 'deal.ready') group by action`,
      [`deal:${dealId}`],
    );
    const byKind = (rows: { kind: string; n: string }[]) => Object.fromEntries(rows.map((r) => [r.kind, Number(r.n)]));
    return {
      holds: Number(holds.rows[0]?.n ?? 0),
      holdPending: Number(holds.rows[0]?.pending ?? 0) > 0,
      hand: byKind(hand.rows),
      ecp: byKind(ecp.rows),
      masterHand: byKind(masterHand.rows),
      masterEcp: byKind(masterEcp.rows),
      events: byKind(events.rows),
    };
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

/** Подпись документа на экране v2: шаг 1 — ФИО вводом, шаг 2 — ЭЦП (мок eGov QR); двойные нажатия. */
async function signInV2(page: Page, title: string, toast: string): Promise<void> {
  await expect(page.locator("h1")).toHaveText(title);
  await expect(page.locator("main")).toContainText(t.sign.stepOf(1, 2));
  await page.getByRole("button", { name: ru.app.kit.signature.typeName }).click();
  await page.getByLabel(ru.app.kit.signature.nameLabel).fill("Сапарова Айгерим");
  await page.locator("[data-primary-action]").dblclick();
  await expect(page.locator("main")).toContainText(t.sign.stepOf(2, 2), { timeout: 30_000 });
  await signEcpV2(page, toast);
}

/** Шаг ЭЦП на экране v2 (телефон: способ один — eGov Mobile): «Подписать» → QR → «Я подписал — проверить» дважды → карточка. */
async function signEcpV2(page: Page, toast: string): Promise<void> {
  // Телефон: способ ЭЦП один (eGov Mobile), выбора нет — строка о том, чем подписывать.
  await expect(page.getByText(t.sign.ecp.phoneMethod)).toBeVisible({ timeout: 30_000 });
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
  const masterCtx = await phoneContext(browser, info, POINT.syganak12); // мастер сдаёт работу у адреса «Прихожей»
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

  // ── 2. Мастер в v2: подпись оферты — без согласия для банка закрыта; с отметкой — от руки и ЭЦП ──
  await expectNow(master, dealPath, [mnow.signOffer.title]);
  await master.locator("[data-primary-action]").click();
  await master.waitForURL(/\/sign\//);
  await expect(master.locator("h1")).toHaveText(ms.sign.title.CONTRACT);
  // Что подписывает мастер: «Вы получите»; суммы покупателя (к оплате с защитой сделки) нет.
  await expect(master.locator("main")).toContainText(ms.sign.what.youGet);
  await expect(master.locator("main")).not.toContainText(t.sign.what.total);
  await expect(master.getByRole("region", { name: t.pay.consent.textLabel })).toBeVisible();
  const masterAgree = master.getByRole("checkbox", { name: ms.sign.consent.agree });
  await expect(masterAgree).not.toBeChecked();
  await master.getByRole("button", { name: ru.app.kit.signature.typeName }).click();
  await master.getByLabel(ru.app.kit.signature.nameLabel).fill("Жумабаев Ерлан");
  // Подпись есть, отметки нет — кнопка закрыта, причина рядом.
  await expect(master.locator("[data-primary-action]")).toBeDisabled();
  await expect(master.getByText(ms.sign.consent.locked)).toBeVisible();
  await master.getByText(ms.sign.consent.agree, { exact: true }).click();
  await expect(masterAgree).toBeChecked();
  await expect(master.locator("[data-primary-action]")).toBeEnabled();
  await master.locator("[data-primary-action]").dblclick();
  await expect(master.locator("main")).toContainText(t.sign.stepOf(2, 2), { timeout: 30_000 });
  await signEcpV2(master, t.sign.signed.CONTRACT);
  await expect(nowHeading(master, [mnow.waitPay.title])).toBeVisible();
  // Двойные нажатия мастера — по одной подписи от руки и ЭЦП.
  expect((await facts(dealId)).masterHand.CONTRACT).toBe(1);
  expect((await facts(dealId)).masterEcp.CONTRACT).toBe(1);

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
    await confirmOperationV2(operator, { type: "HOLD", deal: dealNumber, docNumber: "E2E-V2-HOLD", totpSecret: OPERATOR_TOTP_SECRET });
  }
  await expectNow(buyer, dealPath, [now.waitStart.title]);

  // ── 5. Мастер в v2: начинает работу, отчёт о ходе работ, сдача с фото и местом, подпись акта ЭЦП ──
  await expectNow(master, dealPath, [mnow.start.title]);
  await master.locator("[data-primary-action]").click();
  await master.waitForURL(/\/start$/);
  await expect(master.locator("h1")).toHaveText(ms.start.title);
  await master.locator("[data-primary-action]").click();
  const confirm = master.getByRole("dialog", { name: ms.start.confirm.title });
  await expect(confirm).toContainText(ms.start.confirm.body(formatDays(await dealDays(dealId))));
  await confirm.getByRole("button", { name: ms.start.confirm.confirm }).dblclick();
  await master.waitForURL(/\/v2\/deals\/[^/?#]+$/, { timeout: 30_000 });
  await expect(master.getByText(ms.start.started, { exact: true })).toBeVisible();
  await expect(nowHeading(master, [mnow.ready.title])).toBeVisible();
  expect((await facts(dealId)).events["deal.started"]).toBe(1);

  // Отчёт о ходе работ — ссылкой «Добавить отчёт о ходе работ» под «Сейчас»; покупатель видит его на карточке.
  await master.getByRole("link", { name: mnow.ready.progress }).click();
  await master.waitForURL(/\/progress$/);
  await master.getByLabel(ms.progress.textLabel).fill("Собрал корпус, ставлю фасады");
  await master.locator("[data-primary-action]").dblclick();
  await master.waitForURL(/\/v2\/deals\/[^/?#]+$/, { timeout: 30_000 });
  await expect(master.getByText(ms.progress.sent, { exact: true })).toBeVisible();
  await open(buyer, dealPath);
  await expect(buyer.getByRole("heading", { level: 2, name: t.card.reports.section })).toBeVisible();
  await expect(buyer.locator("main")).toContainText("Собрал корпус, ставлю фасады");

  // Без разрешения на геолокацию: «Отметить место сдачи» — честный отказ, место не отмечено (сдачу здесь не отправляем).
  const noGeoCtx = await phoneContext(browser, info);
  const noGeo = await noGeoCtx.newPage();
  await loginAs(noGeo, P.erlan);
  await open(noGeo, `${dealPath}/ready`);
  await noGeo.getByRole("button", { name: ms.ready.place.mark }).click();
  const refused = [ms.ready.place.denied, ms.ready.place.timeout, ms.ready.place.unavailable];
  await expect(noGeo.getByRole("status").filter({ hasText: new RegExp(`^(${refused.map(escape).join("|")})$`) })).toBeVisible({ timeout: 60_000 });
  await noGeoCtx.close();

  // С разрешением (у адреса): без фото сдача не уходит; фото, «Отметить место сдачи» → «Место отмечено», «Сдать работу» дважды.
  await expectNow(master, dealPath, [mnow.ready.title]);
  await master.locator("[data-primary-action]").click();
  await master.waitForURL(/\/ready$/);
  await master.locator("[data-primary-action]").click();
  await expect(master.getByText(ms.ready.errors.photos)).toBeVisible();
  const photo = await sharp({ create: { width: 320, height: 240, channels: 3, background: "#b07a4a" } }).jpeg().toBuffer();
  await master.locator('input[type="file"]:not([capture])').setInputFiles({ name: "result.jpg", mimeType: "image/jpeg", buffer: photo });
  await expect(master.getByRole("progressbar")).toHaveCount(0, { timeout: 30_000 });
  await master.getByRole("button", { name: ms.ready.place.mark }).click();
  await expect(master.getByRole("status").filter({ hasText: ms.ready.place.located })).toBeVisible({ timeout: 30_000 });
  await master.locator("[data-primary-action]").dblclick();
  await master.waitForURL(/\/v2\/deals\/[^/?#]+$/, { timeout: 30_000 });
  await expect(master.getByText(ms.ready.done, { exact: true })).toBeVisible();
  expect((await facts(dealId)).events["deal.ready"]).toBe(1);

  // Акт: только ЭЦП (подписи от руки у мастера нет).
  await expect(nowHeading(master, [mnow.signAct.title])).toBeVisible();
  await master.locator("[data-primary-action]").click();
  await master.waitForURL(/\/sign\//);
  await expect(master.locator("h1")).toHaveText(ms.sign.title.ACCEPTANCE_ACT);
  await expect(master.locator("main")).toContainText(ms.sign.act.meaning);
  await expect(master.locator("main")).not.toContainText(t.sign.hand.section);
  await signEcpV2(master, t.sign.signed.ACCEPTANCE_ACT);
  expect((await facts(dealId)).masterEcp.ACCEPTANCE_ACT).toBe(1);
  expect((await facts(dealId)).masterHand.ACCEPTANCE_ACT).toBeUndefined();

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
    await confirmOperationV2(operator, { type: "RELEASE", deal: dealNumber, docNumber: "E2E-V2-REL", totpSecret: OPERATOR_TOTP_SECRET });
    await confirmOperationV2(operator, { type: "SPLIT_MASTER", deal: dealNumber, docNumber: "E2E-V2-PAY", totpSecret: OPERATOR_TOTP_SECRET });
    await confirmOperationV2(operator, { type: "SPLIT_PLATFORM", deal: dealNumber, docNumber: "E2E-V2-INC", totpSecret: OPERATOR_TOTP_SECRET });
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
