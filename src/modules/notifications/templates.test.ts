import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NOTIFICATIONS } from "@/demo/data";
import { days } from "@/i18n/ru/notifications";
import { renderTemplate, SMS_KINDS, TEMPLATES } from "./templates";

/**
 * INTEGRATOR: сид фазы A ещё содержит уведомления старой модели этапов. Убрать список, когда сид
 * пересоберут под ТЗ (deal.offer.ready, deal.ready, money.* вместо этих видов).
 */
const LEGACY_DEMO_KINDS = new Set(["deal.contract.ready", "deal.payment.marked", "deal.stage.submitted"]);

/** Исходники модулей (без тестов и самого notifications): где вид уведомления пишется строкой. */
async function moduleSources(): Promise<string> {
  const root = path.join(process.cwd(), "src/modules");
  const files = (await readdir(root, { recursive: true })).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.startsWith(`notifications${path.sep}`),
  );
  return (await Promise.all(files.map((f) => readFile(path.join(root, f), "utf8")))).join("\n");
}

/** Вид шлют строкой. Те же строки бывают действиями журнала («action: "offer.accepted"») — они уведомление не шлют. */
const sentBy = (source: string, kind: string) => new RegExp(`(?<!action: )"${kind.replace(/\./g, "\\.")}"`).test(source);

/** formatMoney ставит неразрывные пробелы — сравниваем текст как его видит человек. */
const plain = (s: string) => s.replace(/ /g, " ");

describe("шаблоны уведомлений", () => {
  it("каждый вид уведомления из демо-данных — шаблон или вид, который шлёт модуль", async () => {
    const source = await moduleSources();
    const missing = [...new Set(NOTIFICATIONS.map((n) => n.kind))].filter((k) => !(k in TEMPLATES) && !sentBy(source, k) && !LEGACY_DEMO_KINDS.has(k));
    expect(missing).toEqual([]);
  });

  it("отклик: сумма и срок отформатированы, ссылка — на заявку заказчика", () => {
    const n = renderTemplate("offer.received", { requestId: "r1", requestTitle: "Кухня", price: 980000, durationDays: 35 });
    expect(n.title).toBe("Новый отклик на заявку");
    expect(plain(n.body)).toBe("На заявку «Кухня» пришёл отклик: 980 000 ₸, срок 35 дней.");
    expect(n.link).toBe("/requests/r1");
  });

  it("ссылки ведут на экран получателя", () => {
    expect(renderTemplate("offer.accepted", { requestId: "r1", requestTitle: "Шкаф" }).link).toBe("/executor/requests/r1");
    expect(renderTemplate("dispute.resolved", { dealId: "d1", dealTitle: "Шкаф" }).link).toBe("/deals/d1");
    expect(renderTemplate("dispute.opened", { audience: "operator", disputeId: "s1", dealTitle: "Шкаф" }).link).toBe("/operator/disputes/s1");
    expect(renderTemplate("dispute.opened", { audience: "party", dealId: "d1", dealTitle: "Шкаф" }).link).toBe("/deals/d1");
    expect(renderTemplate("registration.pending", { profileId: "p1", summary: "ИП, кухни" }).link).toBe("/operator/executors/p1");
    expect(renderTemplate("measurement.scheduled", { audience: "executor", requestId: "r1", requestTitle: "ТВ", at: new Date("2026-11-02T06:00:00Z") }).link).toBe(
      "/executor/requests/r1",
    );
    expect(renderTemplate("registration.received", {}).link).toBeUndefined();
  });

  it("дата замера — по времени Астаны", () => {
    const n = renderTemplate("measurement.scheduled", { audience: "client", requestId: "r1", requestTitle: "ТВ-зона", at: new Date("2026-11-02T06:00:00Z") });
    expect(n.body).toBe("Замер по заявке «ТВ-зона»: 2 ноября 2026, 11:00.");
  });

  it("замер без сделки: плата за выезд упоминается, только если она есть", () => {
    expect(plain(renderTemplate("measurement.no_deal", { requestId: "r", requestTitle: "Ванная", fee: 10000 }).body)).toContain("Плата за выезд — 10 000 ₸");
    expect(renderTemplate("measurement.no_deal", { requestId: "r", requestTitle: "Ванная", fee: null }).body).not.toContain("Плата");
  });

  it("сегмент — по-русски", () => {
    expect(renderTemplate("registration.approved", { segment: "ECONOMY" }).body).toContain("«Эконом»");
  });

  it("SMS только по важным событиям: ответ стороны по сделке, спор, замер, выбор отклика, регистрация", () => {
    expect([...SMS_KINDS].sort()).toEqual([
      "deal.offer.ready",
      "deal.ready",
      "dispute.opened",
      "dispute.resolved",
      "measurement.reminder",
      "offer.accepted",
      "registration.approved",
      "registration.rejected",
      "request.direct",
    ]);
  });

  it("тексты не обещают эскроу и безопасную оплату", async () => {
    const source = await readFile(path.join(process.cwd(), "src/i18n/ru/notifications.ts"), "utf8");
    expect(source.toLowerCase()).not.toMatch(/эскроу|безопасн/);
  });

  it("склонение дней", () => {
    expect([1, 2, 5, 11, 21, 22, 25, 112].map(days)).toEqual(["1 день", "2 дня", "5 дней", "11 дней", "21 день", "22 дня", "25 дней", "112 дней"]);
  });
});

describe("важные уведомления доходят", () => {
  it("каждый вид с SMS кто-то из модулей шлёт под его ключом", async () => {
    const source = await moduleSources();
    expect([...SMS_KINDS].filter((key) => !sentBy(source, key))).toEqual([]);
  });
});
