import { expect, test, type Page } from "@playwright/test";
import { ru } from "@/i18n/ru";
import { OPERATOR, OPERATOR_TOTP_SECRET } from "@/seed/data";
import { passOperatorTotpV2 } from "../operator-support";
import { loginV2, open } from "../support";

/**
 * Решение споров оператором в v2 (набор flows: база e2e пересеяна, данные меняются). Засеянная Динара входит как все —
 * номер, код с экрана, код из приложения. Спор по сделке №9 — «Продолжить работу» (без окна подтверждения: деньги не
 * двигаются); спор по сделке №5 — «Полный возврат покупателю»: перед решением окно с суммой, решение необратимо. После
 * решения на карточке — итог с обоснованием, формы решения больше нет. Только flows-mobile (споры сида одни на пересев).
 */

const t = ru.app.operatorDisputes;
const d = t.decision;

async function openDispute(page: Page, dealNumber: number): Promise<void> {
  await open(page, "/v2/operator/disputes");
  await page.getByRole("link", { name: new RegExp(`^${t.deal(dealNumber)}:`) }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: t.card.title(dealNumber) })).toBeVisible();
}

test("оператор решает споры в v2: продолжить работу и полный возврат с подтверждением", async ({ browser }, info) => {
  test.skip(info.project.name !== "flows-mobile", "споры сида одни на пересев: сценарий — только в flows-mobile");
  test.setTimeout(300_000);
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginV2(page, OPERATOR.phone);
  await passOperatorTotpV2(page, OPERATOR_TOTP_SECRET);

  // ── 1. №9: «Продолжить работу» — без окна подтверждения ──
  await openDispute(page, 9);
  await page.getByText(t.disputes.outcomes.CONTINUE, { exact: true }).click();
  await page.getByLabel(d.rationaleLabel).fill("Недочёты устранимы в рамках работ: мастер исправит фасады до сдачи.");
  await page.getByRole("button", { name: d.submit, exact: true }).click();
  await expect(page.getByRole("heading", { name: t.resolved.title })).toBeVisible();
  await expect(page.getByText("Недочёты устранимы в рамках работ")).toBeVisible();

  // ── 2. №5: «Полный возврат» — окно с суммой, «Не сейчас» ничего не меняет, затем «Вернуть деньги» ──
  await openDispute(page, 5);
  await page.getByText(t.disputes.outcomes.FULL_REFUND, { exact: true }).click();
  await page.getByLabel(d.rationaleLabel).fill("Мастер не приступил к работе в срок, покупатель отказался от сделки.");
  await page.getByRole("button", { name: d.submit, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: d.confirm.FULL_REFUND.title });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("₸");
  await dialog.getByRole("button", { name: d.confirm.cancel }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("heading", { name: t.resolved.title })).toHaveCount(0);

  await page.getByRole("button", { name: d.submit, exact: true }).click();
  await page.getByRole("dialog", { name: d.confirm.FULL_REFUND.title }).getByRole("button", { name: d.confirm.FULL_REFUND.action }).click();
  await expect(page.getByRole("heading", { name: t.resolved.title })).toBeVisible();

  // ── 3. Повторное открытие решённого спора — итог, формы решения нет (двойного решения не будет) ──
  await openDispute(page, 9);
  await expect(page.getByRole("heading", { name: t.resolved.title })).toBeVisible();
  await expect(page.getByRole("button", { name: d.submit, exact: true })).toHaveCount(0);
  await context.close();
});
