import { expect, test, type Page } from "@playwright/test";
import { loginAs, nextStep, openDeal, openMyRequest, P, reseed, signFromNextStep } from "./support";

/**
 * Сделка №14 (заказчик Айгерим, исполнитель Ерлан №3) ждёт подписей договора.
 * Подпись — мок eGov QR → «Я подписал — проверить». Заказчик нажимает дважды подряд,
 * исполнитель подтверждает подпись одновременно из двух вкладок: эффект должен быть один.
 */

test.beforeAll(() => {
  test.setTimeout(120_000);
  reseed();
});

function history(page: Page) {
  return page.locator("section").filter({ has: page.getByRole("heading", { name: "История сделки", exact: true }) }).getByRole("listitem");
}

test("обе стороны подписывают договор: сделка в работе, заявка закрыта, без двойного эффекта", async ({ page, context }) => {
  test.setTimeout(90_000);

  // Заказчик: двойное нажатие «Я подписал — проверить»
  await loginAs(page, P.aigerim);
  const dealPath = await openDeal(page, 14);
  await expect(page.getByText("Ждёт подписи договора")).toBeVisible();
  await expect(nextStep(page).getByText("Подпишите договор. Работы начнутся, когда его подпишут обе стороны.")).toBeVisible();
  const clientPanel = await signFromNextStep(page, { doubleClick: true });
  await expect(clientPanel.getByText("Подпись принята")).toBeVisible();
  await expect(clientPanel.getByRole("alert")).toHaveCount(0); // нет ошибки от второго нажатия
  await expect(clientPanel.getByText(/^Заказчик: подписано /)).toBeVisible();
  await expect(clientPanel.getByText("Исполнитель: ещё не подписал")).toBeVisible();
  await expect(nextStep(page).getByText("Ждём подпись второй стороны. Мы пришлём уведомление.")).toBeVisible();
  await expect(history(page).filter({ hasText: "Сторона подписала документ" })).toHaveCount(1);

  // Исполнитель: две вкладки дошли до «Я подписал — проверить» и нажали одновременно
  await loginAs(page, P.erlan);
  await page.goto(dealPath);
  const second = await context.newPage();
  await second.goto(dealPath);
  const panels = [];
  for (const p of [page, second]) {
    const go = nextStep(p).getByRole("link", { name: "Перейти к подписи" });
    const anchor = await go.getAttribute("href");
    const panel = p.locator(anchor ?? "#missing");
    await panel.getByRole("button", { name: "Подписать", exact: true }).click();
    await expect(panel.getByRole("img", { name: "QR-код для подписи в eGov Mobile" })).toBeVisible();
    panels.push(panel);
  }
  await Promise.all(panels.map((panel) => panel.getByRole("button", { name: "Я подписал — проверить" }).click()));
  // Ровно одна вкладка получила «подписан обеими сторонами», вторая — отказ без второй подписи
  const ok = await Promise.all(
    panels.map(async (panel) => {
      const done = panel.getByText("Документ подписан обеими сторонами", { exact: true });
      const refused = panel.getByRole("alert").filter({ hasText: /уже подписал|уже подписан/ });
      await expect(done.or(refused).first()).toBeVisible();
      return (await done.count()) > 0;
    }),
  );
  expect(ok.filter(Boolean)).toHaveLength(1);
  await second.close();

  // Сделка в работе, договор подписан один раз
  await page.goto(dealPath);
  await expect(page.getByText("Идут работы").first()).toBeVisible();
  await expect(page.getByText("Подписан обеими сторонами").first()).toBeVisible();
  await expect(history(page).filter({ hasText: "Сторона подписала документ" })).toHaveCount(2);
  await expect(history(page).filter({ hasText: "Договор подписан обеими сторонами" })).toHaveCount(1);
  await expect(history(page).filter({ hasText: "Документ подписан обеими сторонами" })).toHaveCount(1);

  // Заявка №16 закрыта
  await loginAs(page, P.aigerim);
  await openMyRequest(page, 16);
  await expect(page.getByText("Договор подписан. Работа идёт в сделке.")).toBeVisible();
  await expect(page.getByText("Договор подписан", { exact: true }).first()).toBeVisible();
});
