import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import type { AuditView } from "@/modules/operator";
import { historyItems, registrationSteps, statusParam } from "./view";

const c = ru.app.operatorQueues.executors.card;

const event = (over: Partial<AuditView>): AuditView => ({
  seq: "1",
  createdAt: new Date("2026-11-16T07:00:00Z"),
  actorId: "op",
  actorRole: "OPERATOR",
  action: "executor.approved",
  entityType: "executor",
  entityId: "p1",
  scope: "executor:p1",
  before: null,
  after: null,
  meta: null,
  ip: null,
  userAgent: null,
  ...over,
});

describe("карточка исполнителя: чистые помощники", () => {
  it("фильтр статуса из адреса: известный статус — он, прочее — «Все»", () => {
    expect(statusParam("APPROVED")).toBe("APPROVED");
    expect(statusParam("approved")).toBeUndefined();
    expect(statusParam(["PENDING"])).toBeUndefined();
    expect(statusParam(undefined)).toBeUndefined();
  });

  it("ход регистрации: ждёт — проверка сейчас; решено — все шаги пройдены, последний называет итог", () => {
    expect(registrationSteps("PENDING").map((s) => s.state)).toEqual(["done", "current", "todo"]);
    expect(registrationSteps("REJECTED")).toEqual([
      { label: c.steps.submitted, state: "done" },
      { label: c.steps.review, state: "done" },
      { label: ru.app.operatorQueues.registration.REJECTED, state: "done" },
    ]);
  });

  it("история: действие словами и кто, причина смены сегмента строкой; незнакомое действие — кодом", () => {
    const [changed, unknown] = historyItems([
      event({ action: "executor.segment.changed", meta: { reason: "Сильное портфолио" } }),
      event({ action: "executor.something", actorRole: "ROBOT" }),
    ]);
    expect(changed).toMatchObject({ title: c.actions["executor.segment.changed"], text: "Сильное портфолио" });
    expect(changed?.time).toContain(c.byRole.OPERATOR);
    expect(unknown).toMatchObject({ title: "executor.something" });
    expect(unknown?.time).toContain("ROBOT");
    expect(unknown).not.toHaveProperty("text");
  });
});
