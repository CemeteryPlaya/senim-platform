import { expect, test, type Page } from "@playwright/test";
import { loginAs, openDeal, P, reseed } from "./support";

/**
 * Доступ к чужим данным (IDOR): чужие заявка, отклик с чатом, сделка, история денег, документ PDF и файл —
 * 404 без данных; гость уходит на вход с возвратом; покупатель и мастер не попадают в раздел оператора.
 * Данные Данияра: сделка №7 (READY, с фото сдачи) с ТОО «Ағаш Шебер», прямая заявка №19 к Исп. №7.
 */

test.beforeAll(() => {
  test.setTimeout(120_000);
  reseed();
});

type Links = { deal: string; money: string; request: string; offer: string | null; pdf: string; photo: string };

/** Адреса Данияра — из его же экранов. */
async function daniyarLinks(page: Page): Promise<Links> {
  await loginAs(page, P.daniyar);
  const deal = await openDeal(page, 7);
  const pdf = await page.getByRole("region", { name: /^Оферта № / }).getByRole("link", { name: /^Открыть PDF/ }).getAttribute("href");
  const photo = await page.getByRole("region", { name: "Сдача работы" }).getByRole("img", { name: "Фото результата 1" }).getAttribute("src");
  await page.goto("/requests");
  await page.getByRole("link", { name: /^Заявка №19:/ }).click();
  await page.waitForURL(/\/requests\/[^/?]+/);
  const request = new URL(page.url()).pathname;
  // Отклик по сделке №7 (с чатом) — из заявки сделки
  await page.goto("/requests");
  const dealRequest = page.getByRole("link", { name: /^Заявка №\d+: Гардеробная/ }).first();
  await dealRequest.click();
  await page.waitForURL(/\/requests\/[^/?]+/);
  const offerLink = page.getByRole("link", { name: /^Подробнее/ }).first();
  const offer = (await offerLink.count()) > 0 ? await offerLink.getAttribute("href") : null;
  if (!pdf || !photo) throw new Error("Не нашли документ или фото сделки №7");
  return { deal, money: `${deal}/money`, request, offer, pdf, photo };
}

const LEAK = /Сделка №7|Заявка №19|Ахметов|Данияр|Ағаш|Примерный, 8|700\s*000\s*01\s*02/;

test("другой покупатель и чужой мастер получают 404 без данных", async ({ page }) => {
  const links = await daniyarLinks(page);

  await loginAs(page, P.aigerim);
  for (const href of [links.deal, links.money, links.request, ...(links.offer ? [links.offer] : [])]) {
    const res = await page.goto(href);
    expect(res?.status(), href).toBe(404);
    await expect(page.getByRole("main")).not.toContainText(LEAK);
  }
  const pdf = await page.request.get(links.pdf);
  expect(pdf.status(), links.pdf).toBe(404);
  expect(await pdf.text()).not.toMatch(LEAK);

  // Мастер №3 не участвует ни в сделке №7, ни в прямой заявке №19 (она для Исп. №7)
  await loginAs(page, P.erlan);
  for (const href of [links.deal, links.money, links.request.replace("/requests/", "/executor/requests/")]) {
    const res = await page.goto(href);
    expect(res?.status(), href).toBe(404);
    await expect(page.getByRole("main")).not.toContainText(LEAK);
  }
  expect((await page.request.get(links.pdf)).status()).toBe(404);
});

test("файл — только по подписанной ссылке: без подписи или с подделанной — 404", async ({ page }) => {
  const links = await daniyarLinks(page);
  const ok = await page.request.get(links.photo);
  expect(ok.status()).toBe(200);
  expect(ok.headers()["content-type"]).toMatch(/^image\//);

  const url = new URL(links.photo, page.url());
  const bare = `${url.pathname}`;
  const forged = new URL(url);
  forged.searchParams.set("sig", "0".repeat(64));
  const expired = new URL(url);
  expired.searchParams.set("exp", "1000");
  for (const href of [bare, forged.pathname + forged.search, expired.pathname + expired.search]) {
    const res = await page.context().request.get(href);
    expect(res.status(), href).toBe(404);
  }
});

test("гость уходит на вход с адресом возврата; документ без входа не отдаётся", async ({ page }) => {
  const links = await daniyarLinks(page);
  await page.context().clearCookies();

  for (const path of [links.deal, links.money, "/requests/new", "/operator", "/operator/money"]) {
    await page.goto(path);
    await page.waitForURL(/\/login\?/);
    expect(new URL(page.url()).searchParams.get("next"), path).toBe(path);
    await expect(page.getByLabel("Номер телефона")).toBeVisible();
  }
  const pdf = await page.request.get(links.pdf);
  expect([401, 403, 404]).toContain(pdf.status());
  expect(pdf.headers()["content-type"] ?? "").not.toContain("application/pdf");
});

test("мастер и покупатель не попадают в раздел оператора", async ({ page }) => {
  for (const persona of [P.erlan, P.aigerim]) {
    await loginAs(page, persona);
    for (const path of ["/operator", "/operator/disputes", "/operator/money", "/operator/deals"]) {
      await page.goto(path);
      await page.waitForURL(/\/login\?/);
      const url = new URL(page.url());
      expect(url.searchParams.get("reason")).toBe("role");
      expect(url.searchParams.get("next")).toBe(path);
      await expect(page.getByText("Эта страница доступна другой роли. Выйдите и войдите под нужным номером.")).toBeVisible();
      await expect(page.getByRole("main")).not.toContainText(/Деньги в банке|Споры|Очередь регистраций/);
    }
  }
});
