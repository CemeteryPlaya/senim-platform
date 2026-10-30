import { expect, test, type Page } from "@playwright/test";
import { choose, loginAs, nextStep, openDeal, P, reseed } from "./support";

/**
 * Спор по сделке №11 (этап 2 сдан): заказчик Айгерим открывает спор о качестве,
 * оператор Динара решает «В пользу заказчика» — этап уходит на доработку, сделка снова в работе.
 */

test.beforeAll(() => {
  test.setTimeout(120_000);
  reseed();
});

function disputeCard(page: Page) {
  return page.locator("section").filter({ has: page.getByRole("heading", { name: "Спор", exact: true }) });
}

test("заказчик открывает спор, оператор принимает решение", async ({ page }) => {
  test.setTimeout(90_000);

  await loginAs(page, P.aigerim);
  const dealPath = await openDeal(page, 11);
  await page.locator("summary", { hasText: "Открыть спор" }).click();
  const form = page.locator("details form");
  await form.getByRole("button", { name: "Открыть спор" }).click();
  await expect(form.getByLabel("Причина спора")).toHaveAttribute("aria-invalid", "true");

  await form.getByLabel("Причина спора").selectOption({ label: "Качество работы" });
  await form.getByLabel("Опишите ситуацию").fill("На дверях шкафа сколы кромки, фото в отчёте этапа не совпадают с фактом.");
  await form.getByRole("button", { name: "Открыть спор" }).click();

  await expect(page.getByText("Открыт спор", { exact: true }).first()).toBeVisible();
  await expect(nextStep(page).getByText("Открыт спор. Оператор изучит позиции сторон и примет решение.")).toBeVisible();
  await expect(disputeCard(page).getByText("Спор открыт")).toBeVisible();

  // Оператор
  await loginAs(page, P.dinara);
  await page.goto("/operator/disputes");
  await page.getByRole("link", { name: /^Сделка №11:/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Спор по сделке №11" })).toBeVisible();
  await expect(page.getByText("На дверях шкафа сколы кромки").first()).toBeVisible();

  await choose(page.getByRole("radio", { name: /^В пользу заказчика/ }));
  await page.getByRole("button", { name: "Принять решение" }).click();
  await expect(page.getByLabel("Обоснование")).toHaveAttribute("aria-invalid", "true");
  await page.getByLabel("Обоснование").fill("Сколы видны на фото заказчика. Исполнитель заменит две двери.");
  await page.getByRole("button", { name: "Принять решение" }).click();
  // Сообщение «Решение принято» исчезает вместе с формой после обновления экрана (см. отчёт QA),
  // поэтому проверяем итог на самом экране спора.
  const decision = page.locator("section, div").filter({ has: page.getByRole("heading", { level: 2, name: "Решение", exact: true }) });
  await expect(page.getByRole("button", { name: "Принять решение" })).toHaveCount(0);
  await expect(decision.getByRole("definition").filter({ hasText: /^В пользу заказчика$/ }).first()).toBeVisible();
  await expect(decision.getByText("Сколы видны на фото заказчика. Исполнитель заменит две двери.").first()).toBeVisible();

  // Заказчик видит решение, этап на доработке, сделка в работе
  await loginAs(page, P.aigerim);
  await page.goto(dealPath);
  await expect(page.getByText("Идут работы").first()).toBeVisible();
  await expect(disputeCard(page).getByText("Спор решён").first()).toBeVisible();
  await expect(disputeCard(page).getByText("В пользу заказчика: этап на доработку")).toBeVisible();
  await expect(disputeCard(page).getByText("Сколы видны на фото заказчика. Исполнитель заменит две двери.")).toBeVisible();
  const stage2 = page.getByRole("region", { name: "Этапы работ" }).getByRole("listitem").filter({ has: page.getByRole("heading", { name: /^Этап 2\./ }) });
  await expect(stage2.getByText("На доработке")).toBeVisible();
});
