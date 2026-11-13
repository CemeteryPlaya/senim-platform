import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { ru } from "@/i18n/ru";
import { notificationsLabel } from "../src/app/(app)/_shell/NotificationsLink";
import { assertSafeDatabase } from "./safe-database";
import { freshPhone, loginV2, open, passOnboarding } from "./support";

/**
 * Уведомления покупателя (/v2/notifications). Новый покупатель (свой номер: лимит кодов засеянных номеров не тратится);
 * уведомления ему кладёт сценарий прямо в базу e2e (только «senim_v2web_*»). Проверяется: пустой экран и блок push,
 * список с непрочитанным, переход по уведомлению ведёт на экран v2 и уменьшает счётчик на колокольчике, «Прочитать все»
 * обнуляет его. Подписи — из ru; один `<h1>`, главного действия на экране нет.
 */

const t = ru.app.chat.notifications;
const p = ru.app.chat.push;

const run = Date.now();

async function insertNotifications(phone: string, rows: { title: string; link: string | null }[]): Promise<void> {
  const url = process.env.E2E_DATABASE_URL ?? "";
  assertSafeDatabase(url);
  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    const user = await db.query<{ id: string }>(`select id from "User" where phone = $1`, [`+7${phone}`]);
    const userId = user.rows[0]?.id;
    if (!userId) throw new Error(`Нет пользователя ${phone} в базе e2e`);
    for (const row of rows) {
      await db.query(
        `insert into "Notification" (id, "userId", kind, title, body, link, "createdAt") values ('e2e' || md5(random()::text), $1, 'e2e', $2, $3, $4, now())`,
        [userId, row.title, "Цена и срок", row.link],
      );
    }
  } finally {
    await db.end();
  }
}

async function expectScreenRules(page: Page) {
  await expect(page.locator("h1")).toHaveCount(1);
  expect(await page.locator("[data-primary-action]").count()).toBe(0);
}

const bell = (page: Page, unread: number) => page.getByRole("link", { name: notificationsLabel(unread) });

test("пустой экран; список с непрочитанным; переход ведёт на экран v2; «Прочитать все» обнуляет счётчик", async ({ page, context }) => {
  await context.clearCookies();
  const phone = freshPhone();
  await loginV2(page, phone.typed);
  await passOnboarding(page);

  // Пусто: обучающий экран, «Прочитать все» нет, блок push (если сервер выдал ключ) — с честным состоянием.
  await open(page, "/v2/notifications");
  await expect(page.getByRole("heading", { level: 1, name: t.title })).toBeVisible();
  await expect(page.getByText(t.emptyTitle)).toBeVisible();
  await expect(page.getByRole("button", { name: t.markAll })).toHaveCount(0);
  await expect(page.getByRole("link", { name: `${ru.app.kit.back}: ${t.back}` })).toBeVisible();
  await expectScreenRules(page);
  const push = page.getByRole("heading", { name: p.title });
  if (await push.isVisible()) {
    const states: string[] = [p.unsupported, p.denied, p.off, p.on, p.iosInstall];
    await expect.poll(async () => (await page.getByRole("status").allInnerTexts()).some((text) => states.includes(text))).toBe(true);
  }

  await insertNotifications(phone.digits, [
    { title: `Сообщение ${run}`, link: "/requests/e2e-request/offers/e2e-offer#chat" },
    { title: `Сделка ${run}`, link: "/deals/e2e-deal" },
    { title: `Без ссылки ${run}`, link: null },
  ]);

  // Колокольчик на главной (корневой экран вкладки): три непрочитанных.
  await open(page, "/v2");
  await expect(bell(page, 3)).toBeVisible();

  await open(page, "/v2/notifications");
  await expect(page.getByText(`Сообщение ${run}`)).toBeVisible();
  await expect(page.getByText(`${t.unread}: `)).toHaveCount(3);
  await expectScreenRules(page);

  // Вид: непрочитанное — заголовок 600, прочитанное — 400; текст 15 px и время 13 px обычного веса, вторичным цветом.
  const row = page.getByRole("button", { name: new RegExp(`Сообщение ${run}`) });
  const css = (locator: ReturnType<Page["locator"]>, prop: string) => locator.evaluate((el, name) => getComputedStyle(el).getPropertyValue(name), prop);
  const title = row.locator("span", { hasText: `Сообщение ${run}` }).last();
  expect(await css(title, "font-weight")).toBe("600");
  const bodyText = row.getByText("Цена и срок");
  expect(await css(bodyText, "font-weight")).toBe("400");
  expect(await css(bodyText, "font-size")).toBe("15px");
  const timeText = row.locator("span.text-small");
  expect(await css(timeText, "font-weight")).toBe("400");
  expect(await css(timeText, "font-size")).toBe("13px");
  expect(await css(bodyText, "color")).toBe(await css(timeText, "color"));

  // Переход по уведомлению: на экран v2 (диалог), уведомление прочитано, счётчик меньше.
  await page.getByRole("button", { name: new RegExp(`Сообщение ${run}`) }).click();
  await page.waitForURL(/\/v2\/chats\/e2e-offer$/);
  await open(page, "/v2");
  await expect(bell(page, 2)).toBeVisible();

  // Прочитанное — заголовок обычного веса.
  await open(page, "/v2/notifications");
  const readTitle = page.getByRole("button", { name: new RegExp(`Сообщение ${run}`) }).locator("span", { hasText: `Сообщение ${run}` }).last();
  expect(await readTitle.evaluate((el) => getComputedStyle(el).fontWeight)).toBe("400");

  // Вторая — сделка: ведёт под /v2/deals/.
  await open(page, "/v2/notifications");
  await page.getByRole("button", { name: new RegExp(`Сделка ${run}`) }).click();
  await page.waitForURL(/\/v2\/deals\/e2e-deal$/);

  // «Прочитать все»: непрочитанных нет, кнопка исчезла, колокольчик без числа.
  await open(page, "/v2/notifications");
  await page.getByRole("button", { name: t.markAll }).click();
  await expect(page.getByRole("button", { name: t.markAll })).toHaveCount(0);
  await expect(page.getByText(`${t.unread}: `)).toHaveCount(0);
  await open(page, "/v2");
  await expect(bell(page, 0)).toBeVisible();
});
