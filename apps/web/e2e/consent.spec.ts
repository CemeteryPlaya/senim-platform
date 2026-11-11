import { expect, test } from "@playwright/test";
import { testIin } from "@/demo/kz-id";
import { acceptConsent, expectOnePrimary, loginByPhone } from "./support";

/**
 * Согласие на обработку ПДн (A.7 P2, P6, P7): вход новым номером → экран согласия (текст текущей редакции, одна главная
 * кнопка, «Назад» видна) → знакомство → кабинет; «Мои данные» → отзыв с подтверждением → статус заявки со сроком,
 * согласие действует до решения оператора (кнопки отзыва больше нет). Номер и ИИН — новые на каждый прогон.
 */

const stamp = Date.now() % 10_000;
/** +7 70090 NNNN P: NNNN — от времени прогона, P — проект (у mobile и desktop свои номера: код на номер — раз в минуту). */
const phoneFor = (project: string) => `+770090${String(stamp).padStart(4, "0")}${project === "desktop" ? "1" : "0"}`;

test("новый номер: согласие → знакомство → кабинет; «Мои данные» → отзыв → статус заявки", async ({ page }, info) => {
  await loginByPhone(page, phoneFor(info.project.name));

  await expect(page).toHaveURL(/\/consent\?next=/);
  await expect(page.getByRole("heading", { level: 1, name: "Согласие на сбор и обработку персональных данных" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Черновик, требует юридической проверки");
  // «Назад» на экране согласия — выход (кнопка, как на второй ступени оператора): без согласия идти некуда.
  await expect(page.getByRole("main").getByRole("button", { name: "Назад", exact: true })).toBeVisible();
  await expectOnePrimary(page);
  await acceptConsent(page);

  // Дальше — знакомство (ФИО и ИИН собираются только после согласия), затем кабинет заказчика.
  await expect(page.getByRole("heading", { level: 1, name: "Давайте познакомимся" })).toBeVisible();
  await page.getByLabel("ФИО полностью").fill("Тестова Согласия");
  await page.getByLabel("ИИН").fill(testIin("950101", 4, (stamp * 2 + (info.project.name === "desktop" ? 1 : 0)) % 10_000));
  await page.getByRole("button", { name: "Сохранить и продолжить" }).click();
  await expect(page).toHaveURL(/\/requests$/);

  await page.goto("/profile/data");
  await expect(page.getByRole("heading", { level: 1, name: "Мои данные" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Обработка персональных данных");
  await page.getByRole("button", { name: "Отозвать согласие" }).click();
  const dialog = page.getByRole("dialog", { name: "Отозвать согласие на обработку данных?" });
  await expect(dialog).toContainText("15 рабочих дней");
  await dialog.getByRole("button", { name: "Да, отозвать" }).click();

  const status = page.getByRole("region", { name: "Заявка на отзыв согласия" });
  await expect(status).toContainText("На рассмотрении");
  await expect(status).toContainText("Ответ — не позднее");
  await expect(page.getByRole("button", { name: "Отозвать согласие" })).toHaveCount(0);
  // Согласие действует до решения: кабинет открывается, на экран согласия не уводит.
  await page.goto("/requests");
  await expect(page).toHaveURL(/\/requests$/);
});
